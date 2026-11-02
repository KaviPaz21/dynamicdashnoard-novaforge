from __future__ import annotations

import uuid

from fastapi import APIRouter, BackgroundTasks, File, HTTPException, UploadFile
from pydantic import BaseModel

from app.agents.ingest_graph import run_ingest
from app.config import get_settings
from app.db.store import get_store
from app.schemas import Relationship, SourceDoc
from app.services import parsers
from app.services.semantic import load_relationships, save_relationships

router = APIRouter(tags=["sources"])


@router.get("/sources")
async def list_sources() -> list[SourceDoc]:
    store = await get_store()
    docs = [SourceDoc(**d) for d in await store.list_all("sources")]
    return sorted(docs, key=lambda d: d.created_at, reverse=True)


@router.get("/sources/{source_id}")
async def get_source(source_id: str) -> SourceDoc:
    store = await get_store()
    raw = await store.get("sources", source_id)
    if not raw:
        raise HTTPException(404, "Source not found")
    return SourceDoc(**raw)


@router.get("/sources/{source_id}/preview")
async def preview_source(source_id: str, limit: int = 50) -> dict:
    store = await get_store()
    raw = await store.get("sources", source_id)
    if not raw:
        raise HTTPException(404, "Source not found")
    src = SourceDoc(**raw)
    if src.kind == "tabular":
        rows = await store.fetch_rows(source_id, [], limit=min(limit, 500))
        return {"columns": [c.name for c in src.columns], "rows": rows}
    return {"columns": [], "rows": []}


@router.post("/sources/upload")
async def upload(background: BackgroundTasks, files: list[UploadFile] = File(...)) -> dict:
    store = await get_store()
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
        doc = SourceDoc(id=uuid.uuid4().hex, kind=kind, filename=name, name=name, stage="queued")
        await store.upsert("sources", doc.model_dump())
        background.add_task(run_ingest, doc.id, name, data)
        accepted.append(doc)
    return {"sources": accepted, "rejected": rejected}


@router.delete("/sources/{source_id}", status_code=204)
async def delete_source(source_id: str) -> None:
    store = await get_store()
    await store.delete_source_data(source_id)
    await store.delete("sources", source_id)
    rels = await load_relationships(store)
    kept = [r for r in rels if source_id not in (r.from_source, r.to_source)]
    if len(kept) != len(rels):
        await save_relationships(store, kept)


class SemanticModel(BaseModel):
    relationships: list[Relationship]


@router.get("/semantic-model")
async def get_semantic_model() -> SemanticModel:
    return SemanticModel(relationships=await load_relationships(await get_store()))


@router.put("/semantic-model")
async def put_semantic_model(model: SemanticModel) -> SemanticModel:
    await save_relationships(await get_store(), model.relationships)
    return model
