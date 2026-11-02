from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.db.store import get_store
from app.schemas import QueryRequest, QueryResult, SourceDoc
from app.services.filters import QueryError
from app.services.query_engine import run_query
from app.services.semantic import load_relationships

router = APIRouter(tags=["query"])


@router.post("/query")
async def query(req: QueryRequest) -> QueryResult:
    store = await get_store()
    raw = await store.get("sources", req.spec.source_id)
    if not raw:
        raise HTTPException(404, "Source not found")
    try:
        return await run_query(
            store,
            SourceDoc(**raw),
            req.spec,
            req.slicers,
            await load_relationships(store),
            req.exclude_origin,
        )
    except QueryError as e:
        raise HTTPException(400, str(e)) from e
