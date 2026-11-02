from __future__ import annotations

from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.services import geo

router = APIRouter(tags=["geo"])


class GeoItem(BaseModel):
    name: str
    hint: str | None = None


class ResolveRequest(BaseModel):
    kind: Literal["us_state", "country", "city"]
    items: list[GeoItem] = Field(max_length=5000)


@router.post("/geo/resolve")
async def resolve(req: ResolveRequest) -> dict:
    return {"results": geo.resolve(req.kind, [i.model_dump() for i in req.items])}
