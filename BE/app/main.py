from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import bootstrap
from app.config import get_settings
from app.db.store import close_store, get_store
from app.routers import admin, auth, chat, dashboards, geo, query, secure, sources
from app.schemas import SourceDoc, UserDoc
from app.security.deps import current_user
from app.security.transport import SecureTransportMiddleware
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
    await bootstrap.run()
    task = asyncio.create_task(_backfill_geo())
    yield
    task.cancel()
    await close_store()


def create_app() -> FastAPI:
    s = get_settings()
    app = FastAPI(
        title="NovaForge API", version="0.2.0", lifespan=lifespan,
        docs_url=None, redoc_url=None, openapi_url=None,  # the API surface is not advertised
    )
    # Added first = innermost: CORS must wrap the transport so its headers reach the tunnel's own responses too
    app.add_middleware(SecureTransportMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=s.cors_origin_list,
        allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?",
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["x-nf-err", "x-nf-enc"],
    )

    @app.get(f"{s.api_prefix}/health")
    async def health() -> dict:
        return {"status": "ok", "secure_transport": get_settings().secure_transport}

    @app.get(f"{s.api_prefix}/system")
    async def system(_: UserDoc = Depends(current_user)) -> dict:
        cfg = get_settings()  # only whether the assistant can answer: no model, database or deployment details
        return {"assistant_ready": cfg.llm_configured}

    for r in (secure.router, auth.router, admin.router, sources.router, query.router, chat.router, dashboards.router, geo.router):
        app.include_router(r, prefix=s.api_prefix)
    return app


app = create_app()
