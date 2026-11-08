from __future__ import annotations

from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.schemas import UserDoc
from app.security.tokens import TokenError, decode_token
from app.services import users

_bearer = HTTPBearer(auto_error=False)


async def current_claims(creds: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> dict:
    if creds is None or creds.scheme.lower() != "bearer":
        raise HTTPException(401, "Not authenticated", headers={"WWW-Authenticate": "Bearer"})
    try:
        return decode_token(creds.credentials)
    except TokenError as e:
        raise HTTPException(401, str(e), headers={"WWW-Authenticate": "Bearer"}) from e


async def current_user(request: Request, claims: dict = Depends(current_claims)) -> UserDoc:
    """The signed-in user, re-read from the database on every call so a role change, deactivation or
    password reset takes effect immediately. Nothing about the role is taken from the token."""
    user = await users.get_user(claims["sub"])
    if user is None or not user.active:
        raise HTTPException(401, "Account is not active", headers={"WWW-Authenticate": "Bearer"})
    if user.token_version != claims["tv"]:
        raise HTTPException(401, "Session expired, please sign in again", headers={"WWW-Authenticate": "Bearer"})
    request.state.user = user
    await users.touch_active(user)
    return user


async def require_admin(user: UserDoc = Depends(current_user)) -> UserDoc:
    if user.role != "admin":
        raise HTTPException(403, "Administrator access required")
    return user
