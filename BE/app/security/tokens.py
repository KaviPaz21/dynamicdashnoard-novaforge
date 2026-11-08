from __future__ import annotations

import logging
import secrets
import time
import uuid
from datetime import datetime, timezone
from typing import Any

import jwt

from app.config import get_settings
from app.schemas import UserDoc

log = logging.getLogger("novaforge.auth")
_ALG = "HS256"
_ISSUER = "novaforge"
_ephemeral: str | None = None
# jti -> exp for tokens revoked by sign-out; entries disappear once the token would have expired anyway
_revoked: dict[str, int] = {}


class TokenError(Exception):
    pass


def _secret() -> str:
    global _ephemeral
    s = get_settings().jwt_secret
    if len(s) >= 32:
        return s
    if _ephemeral is None:
        _ephemeral = secrets.token_urlsafe(48)
        log.warning("JWT_SECRET is missing or shorter than 32 chars: using a random one, tokens die on restart")
    return _ephemeral


def create_token(user: UserDoc) -> tuple[str, str]:
    now = int(time.time())
    exp = now + get_settings().jwt_ttl_minutes * 60
    claims: dict[str, Any] = {
        "iss": _ISSUER, "sub": user.id, "tv": user.token_version, "iat": now, "exp": exp, "jti": uuid.uuid4().hex,
    }
    expires_at = datetime.fromtimestamp(exp, timezone.utc).isoformat(timespec="seconds")
    return jwt.encode(claims, _secret(), algorithm=_ALG), expires_at


def decode_token(token: str) -> dict[str, Any]:
    try:
        claims = jwt.decode(
            token, _secret(), algorithms=[_ALG], issuer=_ISSUER, options={"require": ["exp", "sub", "tv", "jti"]}
        )
    except jwt.ExpiredSignatureError as e:
        raise TokenError("Session expired, please sign in again") from e
    except jwt.PyJWTError as e:
        raise TokenError("Invalid token") from e
    if claims["jti"] in _revoked:
        raise TokenError("Signed out")
    return claims


def revoke(claims: dict[str, Any]) -> None:
    now = int(time.time())
    for jti in [j for j, exp in _revoked.items() if exp < now]:
        _revoked.pop(jti, None)
    _revoked[claims["jti"]] = int(claims["exp"])
