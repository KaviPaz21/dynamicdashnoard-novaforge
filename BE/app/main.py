from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.db.store import close_store, get_store
from app.routers import chat, dashboards, geo, query, sources
from app.schemas import SourceDoc
from app.services.geo import ensure_geo


async def _backfill_geo() -> None:
    store = await get_store()
    for raw in await store.list_all("sources"):
        try:
            await ensure_geo(store, SourceDoc(**raw))
        except Exception:
            pass


@asynccontextmanager
async def lifespan(_: FastAPI):
    await get_store()
    task = asyncio.create_task(_backfill_geo())
    yield
    task.cancel()
    await close_store()


def create_app() -> FastAPI:
    s = get_settings()
    app = FastAPI(title="NovaForge API", version="0.1.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=s.cors_origin_list,
        allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?",
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get(f"{s.api_prefix}/health")
    async def health() -> dict:
        store = await get_store()
        return {
            "status": "ok",
            "store": store.backend,
            "llm_configured": s.llm_configured,
            "llm_model": s.llm_model,
            "embeddings_configured": s.embeddings_configured,
        }

    for r in (sources.router, query.router, chat.router, dashboards.router, geo.router):
        app.include_router(r, prefix=s.api_prefix)
    return app


app = create_app()
