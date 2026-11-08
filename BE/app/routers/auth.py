from __future__ import annotations

import time

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from app.config import get_settings
from app.schemas import UserDoc, UserPublic, utcnow
from app.security.deps import current_claims, current_user
from app.security.passwords import (
    DUMMY_HASH, hash_password_async, password_problem, verify_password_async,
)
from app.security.tokens import create_token, revoke
from app.services import users

router = APIRouter(prefix="/auth", tags=["auth"])

_failures: dict[str, list[float]] = {}


class LoginBody(BaseModel):
    email: str = Field(max_length=254)
    password: str = Field(max_length=256)


class SessionOut(BaseModel):
    token: str
    expires_at: str
    user: UserPublic


class ChangePasswordBody(BaseModel):
    current_password: str = Field(max_length=256)
    new_password: str = Field(max_length=256)





def _session(user: UserDoc) -> SessionOut:
    token, expires_at = create_token(user)
    return SessionOut(token=token, expires_at=expires_at, user=UserPublic.of(user))


def _recent(bucket: dict[str, list[float]], key: str, window: float) -> list[float]:
    now = time.monotonic()
    hits = [t for t in bucket.get(key, []) if now - t < window]
    bucket[key] = hits
    return hits


@router.post("/login")
async def login(body: LoginBody, request: Request) -> SessionOut:
    s = get_settings()
    try:
        email = users.normalize_email(body.email)
    except users.UserError:
        email = body.email.strip().lower()[:254]
    key = f"{email}|{request.client.host if request.client else '?'}"
    if len(_recent(_failures, key, s.login_lock_seconds)) >= s.login_max_failures:
        raise HTTPException(
            429, "Too many failed attempts. Try again in a few minutes.", headers={"Retry-After": str(s.login_lock_seconds)}
        )
    user = await users.get_by_email(email)
    ok = await verify_password_async(body.password, user.password_hash if user else DUMMY_HASH)
    if not user or not ok:
        _failures.setdefault(key, []).append(time.monotonic())
        raise HTTPException(401, "Invalid email or password")
    if not user.active:
        raise HTTPException(403, "This account has been deactivated. Contact an administrator.")
    _failures.pop(key, None)
    now = utcnow()

    def stamp(u: UserDoc) -> None:
        u.last_login = u.last_active = now

    user = await users.mutate(user.id, stamp) or user
    return _session(user)


@router.get("/me")
async def me(user: UserDoc = Depends(current_user)) -> UserPublic:
    return UserPublic.of(user)


@router.post("/refresh")
async def refresh(user: UserDoc = Depends(current_user)) -> SessionOut:
    return _session(user)


@router.post("/logout", status_code=204)
async def logout(claims: dict = Depends(current_claims)) -> None:
    revoke(claims)


@router.post("/change-password")
async def change_password(body: ChangePasswordBody, user: UserDoc = Depends(current_user)) -> SessionOut:
    if not await verify_password_async(body.current_password, user.password_hash):
        raise HTTPException(400, "Current password is incorrect")
    if (problem := password_problem(body.new_password)):
        raise HTTPException(400, problem)
    if body.new_password == body.current_password:
        raise HTTPException(400, "Choose a password you have not used before")
    new_hash = await hash_password_async(body.new_password)

    def apply(u: UserDoc) -> None:
        u.password_hash = new_hash
        u.must_change_password = False
        u.token_version += 1  # every older token stops working

    updated = await users.mutate(user.id, apply)
    return _session(updated or user)
