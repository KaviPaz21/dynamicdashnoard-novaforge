from __future__ import annotations

import re
import uuid

from app.db.store import Store
from app.schemas import ActiveFilter, Filter, Relationship, SourceDoc

META_ID = "semantic_model"
_JOINABLE_ROLES = {"dimension", "date", "id", "geo_lat", "geo_lon", "geo_country", "geo_state", "geo_city"}
_FAMILY = {"string": "s", "integer": "i", "boolean": "b", "date": "d", "datetime": "d", "float": "f"}


def _norm(name: str) -> str:
    return re.sub(r"[^a-z0-9]", "", name.lower())


async def load_relationships(store: Store) -> list[Relationship]:
    doc = await store.get("meta", META_ID)
    return [Relationship(**r) for r in (doc or {}).get("relationships", [])]


async def save_relationships(store: Store, rels: list[Relationship]) -> None:
    await store.upsert("meta", {"id": META_ID, "relationships": [r.model_dump() for r in rels]})


def detect_relationships(new: SourceDoc, others: list[SourceDoc], existing: list[Relationship]) -> list[Relationship]:
    have = {(r.from_source, r.from_column, r.to_source, r.to_column) for r in existing}
    found: list[Relationship] = []
    for other in others:
        if other.id == new.id or other.kind != "tabular" or other.status != "ready":
            continue
        by_name = {_norm(c.name): c for c in other.columns if c.role in _JOINABLE_ROLES}
        for c in new.columns:
            if c.role not in _JOINABLE_ROLES:
                continue
            match = by_name.get(_norm(c.name))
            if not match or _FAMILY[match.dtype] != _FAMILY[c.dtype]:
                continue
            key, rkey = (new.id, c.name, other.id, match.name), (other.id, match.name, new.id, c.name)
            if key in have or rkey in have:
                continue
            have.add(key)
            found.append(
                Relationship(
                    id=uuid.uuid4().hex[:10],
                    from_source=new.id,
                    from_column=c.name,
                    to_source=other.id,
                    to_column=match.name,
                )
            )
    return found


def resolve_slicers(
    target_source: str,
    slicers: list[ActiveFilter],
    rels: list[Relationship],
    exclude_origin: str | None = None,
) -> list[Filter]:
    out: list[Filter] = []
    for s in slicers:
        if exclude_origin and s.origin_widget_id == exclude_origin:
            continue
        if s.source_id == target_source:
            out.append(Filter(column=s.column, op=s.op, value=s.value))
            continue
        for r in rels:
            if (r.from_source, r.from_column, r.to_source) == (s.source_id, s.column, target_source):
                out.append(Filter(column=r.to_column, op=s.op, value=s.value))
                break
            if (r.to_source, r.to_column, r.from_source) == (s.source_id, s.column, target_source):
                out.append(Filter(column=r.from_column, op=s.op, value=s.value))
                break
    return out
