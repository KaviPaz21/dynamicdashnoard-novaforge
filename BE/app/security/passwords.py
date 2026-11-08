from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import os
import re
import secrets

# scrypt (memory-hard, stdlib): ~32 MiB and ~100 ms per hash. Parameters are stored in the hash so they can be raised later.
_N, _R, _P = 2**15, 8, 1
_MAXMEM = 128 * 1024 * 1024
_ALPHABET = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def _b64(b: bytes) -> str:
    return base64.b64encode(b).decode()


def _scrypt(password: str, salt: bytes, n: int, r: int, p: int) -> bytes:
    return hashlib.scrypt(password.encode("utf-8"), salt=salt, n=n, r=r, p=p, dklen=32, maxmem=_MAXMEM)


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    return f"scrypt${_N}${_R}${_P}${_b64(salt)}${_b64(_scrypt(password, salt, _N, _R, _P))}"


def verify_password(password: str, stored: str) -> bool:
    try:
        scheme, n, r, p, salt, digest = stored.split("$")
        if scheme != "scrypt":
            return False
        got = _scrypt(password, base64.b64decode(salt), int(n), int(r), int(p))
        return hmac.compare_digest(got, base64.b64decode(digest))
    except Exception:
        return False


async def hash_password_async(password: str) -> str:
    return await asyncio.to_thread(hash_password, password)


async def verify_password_async(password: str, stored: str) -> bool:
    return await asyncio.to_thread(verify_password, password, stored)


# Verified against when the email is unknown so a login attempt takes the same time either way
DUMMY_HASH = hash_password(secrets.token_urlsafe(12))


def password_problem(password: str) -> str | None:
    if len(password) < 10:
        return "Password must be at least 10 characters"
    if len(password) > 128:
        return "Password must be at most 128 characters"
    if not re.search(r"[A-Za-z]", password) or not re.search(r"\d", password):
        return "Password must contain letters and digits"
    return None


def generate_temp_password() -> str:
    while True:
        pw = "".join(secrets.choice(_ALPHABET) for _ in range(14))
        if password_problem(pw) is None:
            return pw
