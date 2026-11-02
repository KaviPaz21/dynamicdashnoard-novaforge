from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException

from app.db.store import get_store
from app.schemas import Sheet, SheetInfo, SheetUpsert, utcnow

router = APIRouter(tags=["dashboards"])


def _strip(sheet: Sheet) -> Sheet:
    for w in sheet.widgets:
        w.data = None
        w.trend_data = None
        w.error = None
    return sheet


@router.get("/dashboards")
async def list_sheets() -> list[SheetInfo]:
    store = await get_store()
    docs = await store.list_all("dashboards")
    docs.sort(key=lambda d: d.get("created_at", ""))
    return [
        SheetInfo(id=d["id"], name=d["name"], widget_count=len(d.get("widgets", [])), updated_at=d["updated_at"])
        for d in docs
    ]


@router.post("/dashboards", status_code=201)
async def create_sheet(body: SheetUpsert) -> Sheet:
    sheet = _strip(
        Sheet(id=uuid.uuid4().hex, name=body.name.strip() or "Sheet", widgets=body.widgets, filters=body.filters)
    )
    await (await get_store()).upsert("dashboards", sheet.model_dump())
    return sheet


@router.get("/dashboards/{sheet_id}")
async def get_sheet(sheet_id: str) -> Sheet:
    raw = await (await get_store()).get("dashboards", sheet_id)
    if not raw:
        raise HTTPException(404, "Dashboard not found")
    return Sheet(**raw)


@router.put("/dashboards/{sheet_id}")
async def save_sheet(sheet_id: str, body: SheetUpsert) -> Sheet:
    store = await get_store()
    raw = await store.get("dashboards", sheet_id)
    if not raw:
        raise HTTPException(404, "Dashboard not found")
    sheet = Sheet(**raw)
    sheet.name = body.name.strip() or sheet.name
    sheet.widgets = body.widgets
    sheet.filters = body.filters
    sheet.updated_at = utcnow()
    await store.upsert("dashboards", _strip(sheet).model_dump())
    return sheet


@router.delete("/dashboards/{sheet_id}", status_code=204)
async def delete_sheet(sheet_id: str) -> None:
    await (await get_store()).delete("dashboards", sheet_id)
