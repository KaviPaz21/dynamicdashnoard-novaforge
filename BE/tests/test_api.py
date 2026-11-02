from __future__ import annotations

import json
from pathlib import Path

import httpx
import pytest

from app.agents import chat_graph
from app.db import store as store_mod
from app.db.store import MemoryStore
from app.main import app
from app.schemas import Measure, QuerySpec

SAMPLES = Path(__file__).resolve().parent.parent / "sample_data"


@pytest.fixture
async def client(monkeypatch):
    monkeypatch.setattr(store_mod, "_store", MemoryStore())
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
        yield c


async def test_sheets_crud_strips_data_and_keeps_layout(client):
    widget = {
        "id": "w1", "type": "card", "title": "Sales", "source_id": "s",
        "layout": {"w": 3, "h": 2, "x": 3, "y": 1},
        "data": {"columns": [], "rows": [{"a": 1}], "total_rows": 1, "truncated": False},
    }
    created = (await client.post("/api/dashboards", json={"name": "  Sales overview ", "widgets": [widget]})).json()
    assert created["name"] == "Sales overview" and created["widgets"][0]["data"] is None

    listing = (await client.get("/api/dashboards")).json()
    assert [(s["name"], s["widget_count"]) for s in listing] == [("Sales overview", 1)]

    widget["layout"] = {"w": 6, "h": 3, "x": 0, "y": 0}
    flt = {"source_id": "s", "column": "State", "op": "in", "value": ["Texas"], "origin_widget_id": "w1", "label": None}
    saved = (await client.put(
        f"/api/dashboards/{created['id']}", json={"name": "Renamed", "widgets": [widget], "filters": [flt]}
    )).json()
    assert saved["name"] == "Renamed"
    again = (await client.get(f"/api/dashboards/{created['id']}")).json()
    assert again["widgets"][0]["layout"] == {"w": 6, "h": 3, "x": 0, "y": 0}
    assert [(f["column"], f["value"]) for f in again["filters"]] == [("State", ["Texas"])]
    cleared = (await client.put(f"/api/dashboards/{created['id']}", json={"name": "Renamed", "widgets": [widget]})).json()
    assert cleared["filters"] == []

    assert (await client.delete(f"/api/dashboards/{created['id']}")).status_code == 204
    assert (await client.get(f"/api/dashboards/{created['id']}")).status_code == 404
    assert (await client.put("/api/dashboards/nope", json={"name": "x", "widgets": []})).status_code == 404


async def test_upload_query_and_stream(client, monkeypatch):
    f = SAMPLES / "synthetic_combustion_experiments.csv"
    r = await client.post("/api/sources/upload", files=[("files", (f.name, f.read_bytes(), "text/csv"))])
    assert r.status_code == 200 and not r.json()["rejected"]
    sid = r.json()["sources"][0]["id"]

    src = (await client.get(f"/api/sources/{sid}")).json()
    assert src["status"] == "ready" and src["row_count"] == 180

    q = await client.post("/api/query", json={
        "spec": QuerySpec(source_id=sid, measures=[Measure(agg="count", alias="n")]).model_dump(),
        "slicers": [{"source_id": sid, "column": "fuel", "op": "eq", "value": "PMMA"}],
    })
    assert q.status_code == 200 and 0 < q.json()["rows"][0]["n"] < 180

    bad = await client.post("/api/query", json={"spec": {"source_id": sid, "select": ["nope"]}})
    assert bad.status_code == 400

    prev = await client.get(f"/api/sources/{sid}/preview?limit=5")
    assert len(prev.json()["rows"]) == 5

    rejected = await client.post("/api/sources/upload", files=[("files", ("x.exe", b"MZ", "application/octet-stream"))])
    assert rejected.json()["rejected"]

    async def fake_structured(schema, messages):
        if schema is chat_graph.Synthesis:
            return chat_graph.Synthesis(answer="hello", suggestions=["next?"])
        return chat_graph.Route(intent="general", reasoning="chit-chat")

    monkeypatch.setattr(chat_graph, "structured", fake_structured)
    events = []
    async with client.stream("POST", "/api/chat/stream", json={"message": "hi"}) as resp:
        name = None
        async for line in resp.aiter_lines():
            if line.startswith("event: "):
                name = line[7:]
            elif line.startswith("data: "):
                events.append((name, json.loads(line[6:])))
    assert [e[0] for e in events][0] == "start" and events[-1][0] == "final"
    assert any(e[0] == "step" and e[1]["node"] == "route" for e in events)
    cid = events[-1][1]["conversation_id"]
    conv = (await client.get(f"/api/conversations/{cid}")).json()
    assert [m["role"] for m in conv["messages"]] == ["user", "assistant"]

    health = (await client.get("/api/health")).json()
    assert health["store"] == "memory"

    assert (await client.delete(f"/api/sources/{sid}")).status_code == 204
    assert (await client.get(f"/api/sources/{sid}")).status_code == 404
