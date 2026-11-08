from __future__ import annotations

import httpx
import pytest

from app import llm
from app.config import get_settings
from app.db import store as store_mod
from app.db.store import MemoryStore
from app.main import app
from app.schemas import UserDoc
from app.security.passwords import hash_password
from app.security.tokens import create_token
from app.services import users

PASSWORDS = {"admin": "Admin-pass-1234", "alice": "Alice-pass-1234", "bob": "Bob-pass-12345"}


@pytest.fixture(autouse=True)
def no_real_llm(monkeypatch):
    s = get_settings()
    for field in ("llm_api_key", "embedding_api_key"):
        monkeypatch.setattr(s, field, "")
    llm.get_chat_model.cache_clear()
    llm.get_embeddings.cache_clear()
    yield
    llm.get_chat_model.cache_clear()
    llm.get_embeddings.cache_clear()


class World:
    """An in-memory API with one admin and two clients, each already holding a valid token."""

    def __init__(self, client: httpx.AsyncClient, people: dict[str, UserDoc]) -> None:
        self.client, self.people = client, people

    def h(self, who: str) -> dict[str, str]:
        return {"Authorization": f"Bearer {create_token(self.people[who])[0]}"}

    def id(self, who: str) -> str:
        return self.people[who].id


@pytest.fixture
async def world(monkeypatch):
    monkeypatch.setattr(store_mod, "_store", MemoryStore())
    s = get_settings()
    monkeypatch.setattr(s, "secure_transport", "off")
    monkeypatch.setattr(s, "jwt_secret", "t" * 64)
    users.invalidate()
    people = {
        "admin": await users.create_user(
            name="Ada Admin", email="admin@example.com", role="admin", password_hash=hash_password(PASSWORDS["admin"]),
            created_by=None, must_change=False,
        ),
        "alice": await users.create_user(
            name="Alice Client", email="alice@example.com", role="client", password_hash=hash_password(PASSWORDS["alice"]),
            created_by=None, must_change=False,
        ),
        "bob": await users.create_user(
            name="Bob Client", email="bob@example.com", role="client", password_hash=hash_password(PASSWORDS["bob"]),
            created_by=None, must_change=False,
        ),
    }
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
        yield World(c, people)
    users.invalidate()
