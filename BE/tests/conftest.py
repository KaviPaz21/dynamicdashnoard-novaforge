import pytest

from app import llm
from app.config import get_settings


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
