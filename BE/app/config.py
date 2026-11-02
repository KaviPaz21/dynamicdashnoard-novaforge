from functools import lru_cache
from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BASE_DIR / ".env", env_file_encoding="utf-8", extra="ignore"
    )

    api_prefix: str = "/api"
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"

    cosmos_endpoint: str = ""
    cosmos_key: str = ""
    cosmos_database: str = "novaforge"
    cosmos_verify_ssl: bool = True
    cosmos_write_concurrency: int = 32

    llm_base_url: str = ""
    llm_api_key: str = ""
    llm_model: str = "gpt-6-luna"
    llm_temperature: float | None = None
    llm_timeout_seconds: int = 120
    llm_api_version: str = "2025-04-01-preview"
    llm_use_responses_api: bool = True

    embedding_base_url: str = ""
    embedding_api_key: str = ""
    embedding_model: str = "text-embedding-3-small"
    embedding_api_version: str = "2023-05-15"
    embedding_dimensions: int = 1536

    max_upload_mb: int = 50
    max_rows_per_dataset: int = 50_000
    chunk_size: int = 1000
    chunk_overlap: int = 150
    rag_top_k: int = 6

    domain_context: str = ""

    @field_validator("llm_temperature", mode="before")
    @classmethod
    def _blank_to_none(cls, v):
        return None if v in ("", None) else v

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def use_cosmos(self) -> bool:
        return bool(self.cosmos_endpoint and self.cosmos_key)

    @property
    def llm_configured(self) -> bool:
        return bool(self.llm_api_key)

    @property
    def embeddings_configured(self) -> bool:
        return bool(self.embedding_api_key or self.llm_api_key)


@lru_cache
def get_settings() -> Settings:
    return Settings()
