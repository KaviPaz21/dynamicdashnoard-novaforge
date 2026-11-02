from __future__ import annotations

from functools import lru_cache
from typing import TypeVar
from urllib.parse import urlsplit

from langchain_core.messages import BaseMessage
from langchain_openai import AzureChatOpenAI, AzureOpenAIEmbeddings, ChatOpenAI, OpenAIEmbeddings
from pydantic import BaseModel

from app.config import get_settings

T = TypeVar("T", bound=BaseModel)


class LLMUnavailable(RuntimeError):
    pass


def _azure_endpoint(url: str) -> str | None:
    parts = urlsplit(url)
    if parts.hostname and parts.hostname.endswith(".azure.com"):
        return f"{parts.scheme}://{parts.netloc}"
    return None


@lru_cache
def get_chat_model() -> ChatOpenAI:
    s = get_settings()
    if not s.llm_configured:
        raise LLMUnavailable("LLM_API_KEY is not configured (see BE/.env)")
    kwargs: dict = dict(
        model=s.llm_model,
        api_key=s.llm_api_key,
        timeout=s.llm_timeout_seconds,
        max_retries=2,
    )
    if s.llm_temperature is not None:
        kwargs["temperature"] = s.llm_temperature
    azure = _azure_endpoint(s.llm_base_url)
    if azure:
        if s.llm_use_responses_api:
            return AzureChatOpenAI(
                azure_endpoint=azure, api_version=s.llm_api_version, use_responses_api=True, **kwargs
            )
        return AzureChatOpenAI(
            azure_endpoint=azure, api_version=s.llm_api_version, azure_deployment=s.llm_model, **kwargs
        )
    return ChatOpenAI(base_url=s.llm_base_url or None, **kwargs)


@lru_cache
def get_embeddings() -> OpenAIEmbeddings:
    s = get_settings()
    if not s.embeddings_configured:
        raise LLMUnavailable("EMBEDDING_API_KEY / LLM_API_KEY is not configured (see BE/.env)")
    key = s.embedding_api_key or s.llm_api_key
    url = s.embedding_base_url or s.llm_base_url
    azure = _azure_endpoint(url)
    if azure:
        return AzureOpenAIEmbeddings(
            azure_endpoint=azure,
            azure_deployment=s.embedding_model,
            model=s.embedding_model,
            api_version=s.embedding_api_version,
            api_key=key,
            check_embedding_ctx_length=False,
        )
    return OpenAIEmbeddings(
        model=s.embedding_model, api_key=key, base_url=url or None, check_embedding_ctx_length=False
    )


async def structured(schema: type[T], messages: list[BaseMessage]) -> T:
    model = get_chat_model().with_structured_output(schema, method="function_calling")
    result = await model.ainvoke(messages)
    if result is None:
        raise RuntimeError(f"Model returned no structured output for {schema.__name__}")
    return result  # type: ignore[return-value]


async def embed_texts(texts: list[str], batch: int = 64) -> list[list[float]]:
    emb = get_embeddings()
    out: list[list[float]] = []
    for i in range(0, len(texts), batch):
        out.extend(await emb.aembed_documents(texts[i : i + batch]))
    return out


async def embed_query(text: str) -> list[float]:
    return await get_embeddings().aembed_query(text)
