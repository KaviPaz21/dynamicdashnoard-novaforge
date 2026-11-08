from __future__ import annotations

import re
import uuid
from typing import Literal

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel

from app.agents.ingest_graph import run_ingest
from app.config import get_settings
from app.db.store import get_store
from app.schemas import Relationship, SourceDoc, UserDoc
from app.security.deps import current_user
from app.services import access, parsers, users
from app.services import sources as lifecycle
from app.services.semantic import load_relationships, save_relationships

router = APIRouter(tags=["sources"], dependencies=[Depends(current_user)])

CONV_ID = re.compile(r"^[0-9a-f]{32}$")


@router.get("/sources")
async def list_sources(
    scope: Literal["all", "mine", "global"] = "all", user: UserDoc = Depends(current_user)
) -> list[SourceDoc]:
    docs = await access.readable_sources(await get_store(), user)
    if scope == "mine":
        docs = [d for d in docs if d.visibility == "private"]
    elif scope == "global":
        docs = [d for d in docs if d.visibility == "global"]
    return sorted(docs, key=lambda d: d.created_at, reverse=True)


@router.get("/sources/{source_id}")
async def get_source(source_id: str, user: UserDoc = Depends(current_user)) -> SourceDoc:
    return await access.get_readable(await get_store(), source_id, user)


@router.get("/sources/{source_id}/preview")
async def preview_source(source_id: str, limit: int = 50, user: UserDoc = Depends(current_user)) -> dict:
    store = await get_store()
    src = await access.get_readable(store, source_id, user)
    if src.kind == "tabular":
        rows = await store.fetch_rows(source_id, [], limit=min(limit, 500))
        return {"columns": [c.name for c in src.columns], "rows": rows}
    return {"columns": [], "rows": []}


@router.post("/sources/upload")
async def upload(
    background: BackgroundTasks,
    files: list[UploadFile] = File(...),
    visibility: Literal["private", "global"] = Query("private"),
    conversation_id: str | None = Query(None),
    user: UserDoc = Depends(current_user),
) -> dict:
    if visibility == "global" and user.role != "admin":
        raise HTTPException(403, "Only an administrator can add global knowledge")
    store = await get_store()
    if conversation_id:
        if visibility == "global" or not CONV_ID.match(conversation_id):
            raise HTTPException(400, "Invalid conversation id")
        conv = await store.get("conversations", conversation_id)
        if conv and conv.get("owner_id") != user.id:
            raise HTTPException(404, "Conversation not found")
    limit = get_settings().max_upload_mb * 1024 * 1024
    accepted: list[SourceDoc] = []
    rejected: list[dict] = []
    for f in files:
        name = f.filename or "upload"
        try:
            kind = parsers.detect_kind(name)
        except parsers.UnsupportedFile as e:
            rejected.append({"filename": name, "error": str(e)})
            continue
        data = await f.read()
        if len(data) > limit:
            rejected.append({"filename": name, "error": f"File exceeds {get_settings().max_upload_mb} MB"})
            continue
        doc = SourceDoc(
            id=uuid.uuid4().hex, kind=kind, filename=name, name=name, stage="queued", visibility=visibility,
            owner_id=user.id, owner_name=user.name, conversation_id=conversation_id, size_bytes=len(data),
        )
        await store.upsert("sources", doc.model_dump())
        background.add_task(run_ingest, doc.id, name, data)
        accepted.append(doc)
    if accepted:
        await users.record_usage(user.id, uploads=len(accepted))
    return {"sources": accepted, "rejected": rejected}


@router.delete("/sources/{source_id}", status_code=204)
async def delete_source(source_id: str, background: BackgroundTasks, user: UserDoc = Depends(current_user)) -> None:
    store = await get_store()
    src = await access.get_writable(store, source_id, user)
    await lifecycle.begin_delete(store, src)
    background.add_task(lifecycle.purge, source_id)


class SemanticModel(BaseModel):
    relationships: list[Relationship]


def _key(r: Relationship) -> tuple:
    return (r.from_source, r.from_column, r.to_source, r.to_column)


@router.get("/semantic-model")
async def get_semantic_model(user: UserDoc = Depends(current_user)) -> SemanticModel:
    store = await get_store()
    ids = {s.id for s in await access.readable_sources(store, user)}
    return SemanticModel(relationships=access.visible_relationships(await load_relationships(store), ids))


@router.put("/semantic-model")
async def put_semantic_model(model: SemanticModel, user: UserDoc = Depends(current_user)) -> SemanticModel:
    store = await get_store()
    readable = {s.id: s for s in await access.readable_sources(store, user)}
    existing = await load_relationships(store)
    mine = access.visible_relationships(existing, set(readable))
    old, new = {_key(r): r for r in mine}, {_key(r): r for r in model.relationships}

    def editable(r: Relationship) -> bool:
        both_global = all(readable[i].visibility == "global" for i in (r.from_source, r.to_source) if i in readable)
        return user.role == "admin" or not both_global

    for k in set(old) ^ set(new):
        r = old.get(k) or new[k]
        if r.from_source not in readable or r.to_source not in readable:
            raise HTTPException(404, "Source not found")
        if not editable(r):
            raise HTTPException(403, "Only an administrator can change relationships between global tables")
    hidden = [r for r in existing if _key(r) not in old]
    await save_relationships(store, hidden + list(new.values()))
    return model
