from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException

from app.db.store import get_store
from app.schemas import QueryRequest, QueryResult, UserDoc
from app.security.deps import current_user
from app.services import access
from app.services.filters import QueryError
from app.services.query_engine import run_query
from app.services.semantic import load_relationships

log = logging.getLogger("novaforge.query")
router = APIRouter(tags=["query"], dependencies=[Depends(current_user)])


@router.post("/query")
async def query(req: QueryRequest, user: UserDoc = Depends(current_user)) -> QueryResult:
    store = await get_store()
    src = await access.get_readable(store, req.spec.source_id, user)
    # Slicers on other tables only travel across relationships both sides of which this user can read
    readable = {s.id for s in await access.readable_sources(store, user)}
    slicers = [f for f in req.slicers if f.source_id in readable]
    rels = access.visible_relationships(await load_relationships(store), readable)
    try:
        return await run_query(store, src, req.spec, slicers, rels, req.exclude_origin)
    except QueryError as e:
        log.info("query rejected: %s", e)  # the specifics (column names...) stay in the server log
        raise HTTPException(400, "This visual could not be built from the data.") from e
