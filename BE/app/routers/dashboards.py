from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException

from app.db.store import get_store
from app.schemas import Sheet, SheetInfo, SheetUpsert, UserDoc, utcnow
from app.security.deps import current_user

router = APIRouter(tags=["dashboards"], dependencies=[Depends(current_user)])


def _strip(sheet: Sheet) -> Sheet:
    for w in sheet.widgets:
        w.data = None
        w.trend_data = None
        w.error = None
    return sheet


async def _own(sheet_id: str, user: UserDoc) -> Sheet:
    raw = await (await get_store()).get("dashboards", sheet_id)
    if not raw or raw.get("owner_id") != user.id:
        raise HTTPException(404, "Dashboard not found")  # someone else's sheet looks exactly like a missing one
    return Sheet(**raw)


@router.get("/dashboards")
async def list_sheets(user: UserDoc = Depends(current_user)) -> list[SheetInfo]:
    docs = await (await get_store()).query("dashboards", owner_id=user.id)
    docs.sort(key=lambda d: d.get("created_at", ""))
    return [
        SheetInfo(id=d["id"], name=d["name"], widget_count=len(d.get("widgets", [])), updated_at=d["updated_at"])
        for d in docs
    ]


@router.post("/dashboards", status_code=201)
async def create_sheet(body: SheetUpsert, user: UserDoc = Depends(current_user)) -> Sheet:
    sheet = _strip(
        Sheet(
            id=uuid.uuid4().hex, owner_id=user.id, name=body.name.strip() or "Sheet", widgets=body.widgets,
            filters=body.filters,
        )
    )
    await (await get_store()).upsert("dashboards", sheet.model_dump())
    return sheet


@router.get("/dashboards/{sheet_id}")
async def get_sheet(sheet_id: str, user: UserDoc = Depends(current_user)) -> Sheet:
    return await _own(sheet_id, user)


@router.put("/dashboards/{sheet_id}")
async def save_sheet(sheet_id: str, body: SheetUpsert, user: UserDoc = Depends(current_user)) -> Sheet:
    sheet = await _own(sheet_id, user)
    sheet.name = body.name.strip() or sheet.name
    sheet.widgets = body.widgets
    sheet.filters = body.filters
    sheet.updated_at = utcnow()
    await (await get_store()).upsert("dashboards", _strip(sheet).model_dump())
    return sheet


@router.delete("/dashboards/{sheet_id}", status_code=204)
async def delete_sheet(sheet_id: str, user: UserDoc = Depends(current_user)) -> None:
    await _own(sheet_id, user)
    await (await get_store()).delete("dashboards", sheet_id)
