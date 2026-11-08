"""Deleting knowledge sources.

Removing ~10k row documents one by one takes over a minute on Cosmos (the partition-wide delete is disabled on this account), so
a delete is split in two: the cheap, visible part runs inside the request (hide the source, drop it from every sheet and the
semantic model), the slow purge of rows/chunks runs afterwards in the background. The source stays in the catalog as
`deleting` until the purge is done, so a crash mid-way is finished by `finish_pending_deletes` on the next start.
"""

from __future__ import annotations

import logging

from app.db.store import Store, get_store
from app.schemas import SourceDoc, utcnow
from app.services.semantic import load_relationships, save_relationships

log = logging.getLogger("novaforge.sources")


def _uses(widget: dict, source_id: str) -> bool:
    return source_id in (
        widget.get("source_id"),
        (widget.get("query") or {}).get("source_id"),
        (widget.get("trend") or {}).get("source_id"),
    )


async def strip_from_sheets(store: Store, source_id: str) -> int:
    """Drop every widget and filter that depends on the source from all saved sheets. Returns sheets changed."""
    changed = 0
    for sheet in await store.list_all("dashboards"):
        widgets = sheet.get("widgets", [])
        gone = {w["id"] for w in widgets if _uses(w, source_id)}
        filters = [f for f in sheet.get("filters", []) if f.get("source_id") != source_id and f.get("origin_widget_id") not in gone]
        if not gone and len(filters) == len(sheet.get("filters", [])):
            continue
        sheet["widgets"] = [w for w in widgets if w["id"] not in gone]
        sheet["filters"] = filters
        sheet["updated_at"] = utcnow()
        await store.upsert("dashboards", sheet)
        changed += 1
    return changed


async def begin_delete(store: Store, src: SourceDoc) -> None:
    src.status, src.stage = "deleting", "deleting"
    await store.upsert("sources", src.model_dump())
    await strip_from_sheets(store, src.id)
    rels = await load_relationships(store)
    kept = [r for r in rels if src.id not in (r.from_source, r.to_source)]
    if len(kept) != len(rels):
        await save_relationships(store, kept)


async def purge(source_id: str) -> None:
    """Delete the rows/chunks, then the catalog entry. Safe to run again after a crash."""
    store = await get_store()
    try:
        await store.delete_source_data(source_id)
        await store.delete("sources", source_id)
        log.info("source %s deleted", source_id)
    except Exception:
        log.exception("purging source %s failed; it stays hidden and is retried on the next start", source_id)


async def finish_pending_deletes() -> int:
    store = await get_store()
    pending = [d["id"] for d in await store.query("sources", status="deleting")]
    for sid in pending:
        await purge(sid)
    return len(pending)
