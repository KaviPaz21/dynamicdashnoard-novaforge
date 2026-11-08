from __future__ import annotations

import asyncio
import re
import time
import uuid
from datetime import datetime
from typing import Callable

from app.db.store import get_store
from app.schemas import Role, UserDoc, utcnow

_CACHE_TTL = 15.0
_ACTIVE_WRITE_EVERY = 60.0
_cache: dict[str, tuple[float, UserDoc]] = {}
_locks: dict[str, asyncio.Lock] = {}
_EMAIL = re.compile(r"^[^@\s]{1,64}@[^@\s]+\.[^@\s]{2,}$")


class UserError(ValueError):
    pass


def normalize_email(email: str) -> str:
    email = email.strip().lower()
    if len(email) > 254 or not _EMAIL.match(email):
        raise UserError("Enter a valid email address")
    return email


def _lock(uid: str) -> asyncio.Lock:
    return _locks.setdefault(uid, asyncio.Lock())


def invalidate(uid: str | None = None) -> None:
    if uid is None:
        _cache.clear()
    else:
        _cache.pop(uid, None)


async def get_user(uid: str, fresh: bool = False) -> UserDoc | None:
    hit = _cache.get(uid)
    if hit and not fresh and time.monotonic() - hit[0] < _CACHE_TTL:
        return hit[1].model_copy(deep=True)
    raw = await (await get_store()).get("users", uid)
    if not raw:
        _cache.pop(uid, None)
        return None
    user = UserDoc(**raw)
    _cache[uid] = (time.monotonic(), user)
    return user.model_copy(deep=True)


async def get_by_email(email: str) -> UserDoc | None:
    found = await (await get_store()).query("users", email=email.strip().lower())
    return UserDoc(**found[0]) if found else None


async def list_users() -> list[UserDoc]:
    users = [UserDoc(**d) for d in await (await get_store()).list_all("users")]
    return sorted(users, key=lambda u: u.created_at)


async def create_user(
    *, name: str, email: str, role: Role, password_hash: str, created_by: str | None, must_change: bool = True
) -> UserDoc:
    name = " ".join(name.split())
    if not name or len(name) > 80:
        raise UserError("Name is required (max 80 characters)")
    email = normalize_email(email)
    if await get_by_email(email):
        raise UserError("A user with this email already exists")
    user = UserDoc(
        id=f"usr_{uuid.uuid4().hex[:8]}", name=name, email=email, role=role, password_hash=password_hash,
        must_change_password=must_change, created_by=created_by,
    )
    await (await get_store()).upsert("users", user.model_dump())
    invalidate(user.id)
    return user


async def mutate(uid: str, fn: Callable[[UserDoc], None]) -> UserDoc | None:
    """Read-modify-write one user under a lock so counters and flags from concurrent requests don't clobber each other."""
    async with _lock(uid):
        user = await get_user(uid, fresh=True)
        if not user:
            return None
        fn(user)
        await (await get_store()).upsert("users", user.model_dump())
        _cache[uid] = (time.monotonic(), user)
        return user.model_copy(deep=True)


async def delete_user(uid: str) -> None:
    async with _lock(uid):
        await (await get_store()).delete("users", uid)
        invalidate(uid)


async def touch_active(user: UserDoc) -> None:
    """Record activity, writing at most once a minute per user."""
    if user.last_active:
        try:
            if time.time() - datetime.fromisoformat(user.last_active).timestamp() < _ACTIVE_WRITE_EVERY:
                return
        except ValueError:
            pass
    await mutate(user.id, lambda u: setattr(u, "last_active", utcnow()))


async def record_usage(
    uid: str, *, tokens_in: int = 0, tokens_out: int = 0, prompts: int = 0, sessions: int = 0, flagged: int = 0,
    uploads: int = 0,
) -> None:
    def apply(u: UserDoc) -> None:
        s = u.usage
        s.prompts += prompts
        s.sessions += sessions
        s.flagged += flagged
        s.uploads += uploads
        s.tokens_in += tokens_in
        s.tokens_out += tokens_out
        s.tokens_total += tokens_in + tokens_out
        u.last_active = utcnow()

    await mutate(uid, apply)


async def active_admin_count() -> int:
    return sum(1 for u in await list_users() if u.role == "admin" and u.active)
