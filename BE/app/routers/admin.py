from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, Field

from app.db.store import get_store
from app.schemas import FlagDoc, Role, SourceDoc, UsageStats, UserDoc, UserPublic, utcnow
from app.security.deps import require_admin
from app.security.passwords import generate_temp_password, hash_password_async
from app.services import flags, users
from app.services import sources as lifecycle

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_admin)])
audit = logging.getLogger("novaforge.audit")

_SEVERITY = {"low": 1, "medium": 2, "high": 3}


class NewUser(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    email: str = Field(max_length=254)
    role: Role = "client"


class UserPatch(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=80)
    role: Role | None = None
    active: bool | None = None


class FlagPatch(BaseModel):
    reviewed: bool = True


class UserDetail(UserPublic):
    last_login: str | None = None
    usage: UsageStats
    conversations: int = 0
    sheets: int = 0
    private_sources: int = 0
    flags_total: int = 0
    flags_unreviewed: int = 0


class CreatedUser(BaseModel):
    user: UserPublic
    temp_password: str


async def _target(uid: str) -> UserDoc:
    user = await users.get_user(uid, fresh=True)
    if user is None:
        raise HTTPException(404, "User not found")
    return user


async def _would_leave_no_admin(target: UserDoc) -> bool:
    return target.role == "admin" and target.active and await users.active_admin_count() <= 1


async def _detail(u: UserDoc) -> UserDetail:
    store = await get_store()
    mine = await store.query("flags", user_id=u.id)
    return UserDetail(
        **UserPublic.of(u).model_dump(), last_login=u.last_login, usage=u.usage,
        conversations=len(await store.query("conversations", owner_id=u.id)),
        sheets=len(await store.query("dashboards", owner_id=u.id)),
        private_sources=len(await store.query("sources", owner_id=u.id, visibility="private")),
        flags_total=len(mine), flags_unreviewed=sum(1 for f in mine if not f.get("reviewed")),
    )


@router.get("/users")
async def list_users() -> list[UserPublic]:
    return [UserPublic.of(u) for u in await users.list_users()]


@router.post("/users", status_code=201)
async def create_user(body: NewUser, admin: UserDoc = Depends(require_admin)) -> CreatedUser:
    temp = generate_temp_password()
    try:
        user = await users.create_user(
            name=body.name, email=body.email, role=body.role, password_hash=await hash_password_async(temp),
            created_by=admin.id,
        )
    except users.UserError as e:
        raise HTTPException(400, str(e)) from e
    audit.info("admin %s created user %s (%s)", admin.id, user.id, user.role)
    return CreatedUser(user=UserPublic.of(user), temp_password=temp)


@router.get("/users/{uid}")
async def get_user(uid: str) -> UserDetail:
    return await _detail(await _target(uid))


@router.patch("/users/{uid}")
async def patch_user(uid: str, body: UserPatch, admin: UserDoc = Depends(require_admin)) -> UserDetail:
    target = await _target(uid)
    losing_admin = (body.active is False and target.active) or (body.role == "client" and target.role == "admin")
    if losing_admin and await _would_leave_no_admin(target):
        raise HTTPException(400, "There must always be at least one active administrator")
    if uid == admin.id and (body.active is False or body.role == "client"):
        raise HTTPException(400, "You cannot deactivate or demote your own account")

    def apply(u: UserDoc) -> None:
        if body.name is not None:
            u.name = " ".join(body.name.split())
        if body.role is not None and body.role != u.role:
            u.role = body.role
            u.token_version += 1
        if body.active is not None and body.active != u.active:
            u.active = body.active
            if not u.active:
                u.token_version += 1  # signs the user out everywhere

    updated = await users.mutate(uid, apply)
    audit.info("admin %s changed user %s: %s", admin.id, uid, body.model_dump(exclude_none=True))
    return await _detail(updated or target)


@router.post("/users/{uid}/reset-password")
async def reset_password(uid: str, admin: UserDoc = Depends(require_admin)) -> dict[str, str]:
    await _target(uid)
    temp = generate_temp_password()
    new_hash = await hash_password_async(temp)

    def apply(u: UserDoc) -> None:
        u.password_hash = new_hash
        u.must_change_password = True
        u.token_version += 1

    await users.mutate(uid, apply)
    audit.info("admin %s reset the password of %s", admin.id, uid)
    return {"temp_password": temp}


@router.delete("/users/{uid}", status_code=204)
async def delete_user(uid: str, background: BackgroundTasks, admin: UserDoc = Depends(require_admin)) -> None:
    target = await _target(uid)
    if uid == admin.id:
        raise HTTPException(400, "You cannot delete your own account")
    if await _would_leave_no_admin(target):
        raise HTTPException(400, "There must always be at least one active administrator")
    store = await get_store()
    # the user's own data goes with them; flags stay (they are the safety record) and global knowledge stays
    for conv in await store.query("conversations", owner_id=uid):
        await store.delete("conversations", conv["id"])
    for sheet in await store.query("dashboards", owner_id=uid):
        await store.delete("dashboards", sheet["id"])
    for raw in await store.query("sources", owner_id=uid, visibility="private"):
        await lifecycle.begin_delete(store, SourceDoc(**raw))
        background.add_task(lifecycle.purge, raw["id"])
    await users.delete_user(uid)
    audit.info("admin %s deleted user %s", admin.id, uid)


# --- flagged prompts --------------------------------------------------------------------------------------------


@router.get("/flags/summary")
async def flag_summary() -> dict[str, int]:
    return {"unreviewed": await flags.unreviewed_count()}


@router.get("/flags/users")
async def flagged_users() -> list[dict[str, Any]]:
    grouped: dict[str, dict[str, Any]] = {}
    for raw in await (await get_store()).list_all("flags"):
        f = FlagDoc(**raw)
        g = grouped.setdefault(
            f.user_id,
            {"user_id": f.user_id, "user_name": f.user_name, "user_email": f.user_email, "total": 0, "unreviewed": 0,
             "last_at": "", "severity": "low"},
        )
        g["total"] += 1
        g["unreviewed"] += 0 if f.reviewed else 1
        g["last_at"] = max(g["last_at"], f.created_at)
        if _SEVERITY[f.severity] > _SEVERITY[g["severity"]]:
            g["severity"] = f.severity
    return sorted(grouped.values(), key=lambda g: g["last_at"], reverse=True)


@router.get("/flags")
async def list_flags(user_id: str | None = None) -> list[FlagDoc]:
    store = await get_store()
    raws = await store.query("flags", user_id=user_id) if user_id else await store.list_all("flags")
    return sorted((FlagDoc(**r) for r in raws), key=lambda f: f.created_at, reverse=True)


@router.patch("/flags/{flag_id}")
async def review_flag(flag_id: str, body: FlagPatch, admin: UserDoc = Depends(require_admin)) -> FlagDoc:
    store = await get_store()
    raw = await store.get("flags", flag_id)
    if not raw:
        raise HTTPException(404, "Flag not found")
    flag = FlagDoc(**raw)
    flag.reviewed = body.reviewed
    flag.reviewed_by = admin.id if body.reviewed else None
    flag.reviewed_at = utcnow() if body.reviewed else None
    await store.upsert("flags", flag.model_dump())
    return flag
