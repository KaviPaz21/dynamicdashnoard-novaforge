from __future__ import annotations

import asyncio
import json
import logging
import uuid
from typing import Any, TypedDict

import pandas as pd
from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.graph import END, StateGraph
from pydantic import BaseModel, Field

from app.config import get_settings
from app.db.store import Store, get_store
from app.llm import LLMUnavailable, embed_texts, structured
from app.schemas import ColumnRole, SourceDoc
from app.services import parsers
from app.services.geo import GEO_VERSION
from app.services.schema_infer import infer_table, to_records
from app.services.semantic import detect_relationships, load_relationships, save_relationships

log = logging.getLogger("novaforge.ingest")
# What the person sees when a file can't be processed: the technical cause goes to the server log only
USER_ERROR = "This file could not be processed. Check that it is a valid, readable file and try again."

class IngestState(TypedDict, total=False):
    source_id: str
    filename: str
    data: bytes
    kind: str
    tables: list[dict[str, Any]]
    pages: list[tuple[int | None, str]]
    chunks: list[dict[str, Any]]
    summary: dict[str, Any]


class ColumnNote(BaseModel):
    column: str
    description: str = Field(description="One short sentence: what the column holds, with units if evident")
    role: ColumnRole | None = Field(
        None, description="Only set if the inferred role is wrong (e.g. a coded integer that is really a category)"
    )


class TableProfile(BaseModel):
    title: str = Field(description="Short human title for the dataset")
    description: str = Field(description="2-3 sentences: what the data is, grain of a row, what it is useful for")
    columns: list[ColumnNote]


class DocumentSummary(BaseModel):
    title: str
    summary: str = Field(description="3-5 sentence summary of the document and its main findings")
    topics: list[str] = Field(description="3-8 short topic keywords")


async def _save(store: Store, doc: SourceDoc, **changes: Any) -> SourceDoc:
    for k, v in changes.items():
        setattr(doc, k, v)
    await store.upsert("sources", doc.model_dump())
    return doc


async def detect(state: IngestState) -> IngestState:
    store = await get_store()
    doc = SourceDoc(**(await store.get("sources", state["source_id"])))
    await _save(store, doc, stage="detecting file type")
    try:
        return {"kind": parsers.detect_kind(state["filename"])}
    except parsers.UnsupportedFile as e:
        await _save(store, doc, status="failed", stage="failed", error=str(e))
        return {"kind": "unsupported"}


def route_kind(state: IngestState) -> str:
    return {"tabular": "parse_tables", "text": "extract_text"}.get(state["kind"], END)


async def parse_tables(state: IngestState) -> IngestState:
    store = await get_store()
    base = SourceDoc(**(await store.get("sources", state["source_id"])))
    await _save(store, base, stage="parsing tables")
    frames = await asyncio.to_thread(parsers.read_tables, state["filename"], state["data"])
    tables = []
    for i, (name, df) in enumerate(frames):
        if i == 0:
            doc = base
            doc.name = name
        else:
            doc = base.model_copy(deep=True, update={"id": uuid.uuid4().hex, "name": name})  # same owner/visibility
            await _save(store, doc, stage="parsing tables")
        tables.append({"doc": doc, "df": df})
    return {"tables": tables}


def _profile_prompt(doc: SourceDoc, df: pd.DataFrame) -> list:
    ctx = get_settings().domain_context
    cols = [
        {
            "name": c.name, "type": c.dtype, "role": c.role, "distinct": c.distinct_count,
            "min": c.min, "max": c.max, "examples": c.top_values[:5],
        }
        for c in doc.columns
    ]
    sample = df.head(5).astype(str).to_dict("records")
    return [
        SystemMessage(
            content="You document datasets for an analytics catalog. Be concrete and brief. "
            + (f"Project context: {ctx}" if ctx else "")
        ),
        HumanMessage(
            content=f"File: {doc.filename} (table '{doc.name}', {doc.row_count} rows)\n"
            f"Columns: {json.dumps(cols, default=str)}\nSample rows: {json.dumps(sample, default=str)}"
        ),
    ]


async def profile_tables(state: IngestState) -> IngestState:
    store = await get_store()
    cap = get_settings().max_rows_per_dataset
    for t in state["tables"]:
        doc: SourceDoc = t["doc"]
        await _save(store, doc, stage="understanding structure")
        df: pd.DataFrame = t["df"]
        if len(df) > cap:
            doc.warnings.append(f"Only the first {cap:,} of {len(df):,} rows were loaded")
            df = df.head(cap)
        typed, cols = await asyncio.to_thread(infer_table, df)
        doc.columns, doc.row_count, t["df"] = cols, len(typed), typed
        doc.geo_version = GEO_VERSION
        doc.description = (
            f"Table with {doc.row_count:,} rows and {len(cols)} columns: "
            + ", ".join(c.name for c in cols[:12])
            + ("…" if len(cols) > 12 else "")
        )
        await _save(store, doc, stage="describing dataset")
        try:
            profile = await structured(TableProfile, _profile_prompt(doc, typed))
            by_name = {c.name: c for c in doc.columns}
            for note in profile.columns:
                col = by_name.get(note.column)
                if col:
                    col.description = note.description
                    if note.role:
                        col.role = note.role
            doc.name = profile.title or doc.name
            doc.description = profile.description
        except LLMUnavailable:
            doc.warnings.append("Descriptions were generated automatically")
        except Exception as e:
            log.warning("description generation failed: %s", e)
            doc.warnings.append("Descriptions were generated automatically")
        await _save(store, doc)
    return {}


async def store_tables(state: IngestState) -> IngestState:
    store = await get_store()
    for t in state["tables"]:
        doc: SourceDoc = t["doc"]
        records = await asyncio.to_thread(to_records, t["df"])

        async def progress(done: int, total: int, doc=doc) -> None:
            await _save(store, doc, stage=f"storing rows {done:,}/{total:,}")

        await store.insert_rows(doc.id, records, progress)
        await _save(store, doc, status="ready", stage="ready")

        # Only relate to tables the owner can also see: a global table never links to someone's private one
        sources = [
            s
            for s in (SourceDoc(**d) for d in await store.list_all("sources"))
            if s.visibility == "global" or (doc.visibility == "private" and s.owner_id == doc.owner_id)
        ]
        rels = await load_relationships(store)
        found = detect_relationships(doc, sources, rels)
        if found:
            await save_relationships(store, rels + found)
    return {}


async def extract_text(state: IngestState) -> IngestState:
    store = await get_store()
    doc = SourceDoc(**(await store.get("sources", state["source_id"])))
    await _save(store, doc, stage="extracting text")
    pages = await asyncio.to_thread(parsers.extract_pages, state["filename"], state["data"])
    return {"pages": pages}


async def embed_chunks(state: IngestState) -> IngestState:
    store = await get_store()
    s = get_settings()
    doc = SourceDoc(**(await store.get("sources", state["source_id"])))
    await _save(store, doc, stage="chunking")
    pieces: list[tuple[int | None, str]] = []
    for page, text in state["pages"]:
        pieces += [(page, c) for c in parsers.chunk_text(text, s.chunk_size, s.chunk_overlap)]
    await _save(store, doc, stage=f"embedding {len(pieces)} chunks")
    vectors = await embed_texts([p[1] for p in pieces])
    chunks = [
        {"id": f"{doc.id}:{i}", "chunk_index": i, "page": page, "text": text, "embedding": vec}
        for i, ((page, text), vec) in enumerate(zip(pieces, vectors))
    ]

    summary: dict[str, Any] = {}
    full = "\n\n".join(t for _, t in state["pages"])
    await _save(store, doc, stage="summarising")
    try:
        res = await structured(
            DocumentSummary,
            [
                SystemMessage(
                    content="You summarise research documents for a catalog. "
                    + (f"Project context: {s.domain_context}" if s.domain_context else "")
                ),
                HumanMessage(content=f"File: {doc.filename}\n\n{full[:12000]}"),
            ],
        )
        summary = res.model_dump()
    except Exception:
        summary = {"title": doc.filename, "summary": full[:400].strip() + "…", "topics": []}
    return {"chunks": chunks, "summary": summary}


async def store_text(state: IngestState) -> IngestState:
    store = await get_store()
    doc = SourceDoc(**(await store.get("sources", state["source_id"])))
    await _save(store, doc, stage="storing chunks")
    await store.insert_chunks(doc.id, state["chunks"])
    summary = state.get("summary", {})
    await _save(
        store,
        doc,
        status="ready",
        stage="ready",
        name=summary.get("title") or doc.filename,
        description=summary.get("summary", ""),
        topics=summary.get("topics", []),
        chunk_count=len(state["chunks"]),
        page_count=len({p for p, _ in state["pages"] if p}) or 1,
    )
    return {}


def build_graph():
    g = StateGraph(IngestState)
    g.add_node("detect", detect)
    g.add_node("parse_tables", parse_tables)
    g.add_node("profile_tables", profile_tables)
    g.add_node("store_tables", store_tables)
    g.add_node("extract_text", extract_text)
    g.add_node("embed_chunks", embed_chunks)
    g.add_node("store_text", store_text)
    g.set_entry_point("detect")
    g.add_conditional_edges("detect", route_kind, {"parse_tables": "parse_tables", "extract_text": "extract_text", END: END})
    g.add_edge("parse_tables", "profile_tables")
    g.add_edge("profile_tables", "store_tables")
    g.add_edge("store_tables", END)
    g.add_edge("extract_text", "embed_chunks")
    g.add_edge("embed_chunks", "store_text")
    g.add_edge("store_text", END)
    return g.compile()


_graph = None


async def run_ingest(source_id: str, filename: str, data: bytes) -> None:
    global _graph
    _graph = _graph or build_graph()
    store = await get_store()
    try:
        await _graph.ainvoke({"source_id": source_id, "filename": filename, "data": data})
    except Exception:
        log.exception("ingesting %s failed", filename)
        raw = await store.get("sources", source_id)
        if raw:
            doc = SourceDoc(**raw)
            await _save(store, doc, status="failed", stage="failed", error=USER_ERROR)
            # extra sheets of the same workbook that were still being processed
            for d in await store.query("sources", filename=filename, status="processing", owner_id=doc.owner_id):
                await _save(store, SourceDoc(**d), status="failed", stage="failed", error=USER_ERROR)
