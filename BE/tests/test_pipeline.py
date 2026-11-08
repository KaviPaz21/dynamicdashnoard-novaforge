from __future__ import annotations

import asyncio
from pathlib import Path

import pytest

from app.agents import chat_graph, ingest_graph
from app.db import store as store_mod
from app.db.store import MemoryStore
from app.llm import LLMUnavailable
from app.schemas import (
    ActiveFilter, ChatRequest, Dimension, Encoding, Filter, Measure, QuerySpec, SourceDoc, UserDoc,
)
from app.services import parsers
from app.services.query_engine import run_query
from app.services.semantic import load_relationships

SAMPLES = Path(__file__).resolve().parent.parent / "sample_data"
USER = UserDoc(id="u1", name="Ada Lovelace", email="ada@example.com", password_hash="x")


@pytest.fixture(autouse=True)
async def fresh_store(monkeypatch):
    store = MemoryStore()
    monkeypatch.setattr(store_mod, "_store", store)
    return store


async def _ingest(store, filename: str) -> SourceDoc:
    from app.schemas import SourceDoc as S
    doc = S(id=filename.replace(".", "_"), kind=parsers.detect_kind(filename), filename=filename, name=filename, owner_id=USER.id)
    await store.upsert("sources", doc.model_dump())
    await ingest_graph.run_ingest(doc.id, filename, (SAMPLES / filename).read_bytes())
    return SourceDoc(**(await store.get("sources", doc.id)))


async def test_tabular_ingest_infers_schema(fresh_store):
    src = await _ingest(fresh_store, "synthetic_combustion_experiments.csv")
    assert src.status == "ready", src.error
    assert src.row_count == 180
    cols = {c.name: c for c in src.columns}
    assert cols["date"].dtype == "date" and cols["date"].role == "date"
    assert cols["oxygen_pct"].dtype == "float" and cols["oxygen_pct"].role == "measure"
    assert cols["extinguished"].dtype == "boolean"
    assert cols["fuel"].role == "dimension" and "PMMA" in cols["fuel"].top_values or cols["fuel"].top_values
    assert cols["experiment_id"].role == "id"
    assert src.warnings == ["Descriptions were generated automatically"], "no model names or exception text in the catalog"


async def test_relationships_and_crossfilter(fresh_store):
    exp = await _ingest(fresh_store, "synthetic_combustion_experiments.csv")
    fac = await _ingest(fresh_store, "synthetic_facilities.csv")
    rels = await load_relationships(fresh_store)
    assert any(r.from_column == "platform" for r in rels)
    assert {c.name: c.role for c in fac.columns}["latitude"] == "geo_lat"

    spec = QuerySpec(source_id=exp.id, measures=[Measure(agg="count", alias="n")])
    all_rows = await run_query(fresh_store, exp, spec)
    sliced = await run_query(
        fresh_store, exp, spec,
        slicers=[ActiveFilter(source_id=fac.id, column="platform", op="in", value=["ISS"])],
        relationships=rels,
    )
    assert all_rows.rows[0]["n"] == 180
    assert 0 < sliced.rows[0]["n"] < 180


async def test_group_by_buckets_sort_and_limits(fresh_store):
    exp = await _ingest(fresh_store, "synthetic_combustion_experiments.csv")
    res = await run_query(
        fresh_store, exp,
        QuerySpec(
            source_id=exp.id,
            dimensions=[Dimension(column="fuel")],
            measures=[Measure(column="flame_speed_mm_s", agg="avg", alias="speed"), Measure(agg="count", alias="runs")],
            filters=[Filter(column="oxygen_pct", op="gte", value="20")],
            limit=3,
        ),
    )
    assert [c.name for c in res.columns] == ["fuel", "speed", "runs"]
    assert len(res.rows) == 3 and res.truncated
    speeds = [r["speed"] for r in res.rows]
    assert speeds == sorted(speeds, reverse=True)

    trend = await run_query(
        fresh_store, exp,
        QuerySpec(source_id=exp.id, dimensions=[Dimension(column="date", bucket="year")],
                  measures=[Measure(agg="count", alias="runs")]),
    )
    years = [r["date"] for r in trend.rows]
    assert years == sorted(years) and years[0] == "2019"


async def test_query_errors_are_descriptive(fresh_store):
    exp = await _ingest(fresh_store, "synthetic_combustion_experiments.csv")
    from app.services.filters import QueryError
    with pytest.raises(QueryError, match="Unknown measure column"):
        await run_query(fresh_store, exp, QuerySpec(source_id=exp.id, measures=[Measure(column="nope", alias="x")]))
    with pytest.raises(QueryError, match="non-numeric"):
        await run_query(fresh_store, exp, QuerySpec(source_id=exp.id, measures=[Measure(column="fuel", agg="sum", alias="x")]))


async def test_text_ingest_and_retrieval(fresh_store, monkeypatch):
    async def fake_embed(texts):
        return [[float(len(t) % 7), 1.0, float("oxygen" in t.lower())] for t in texts]

    async def no_llm(*a, **k):
        raise LLMUnavailable("none")

    monkeypatch.setattr(ingest_graph, "embed_texts", fake_embed)
    monkeypatch.setattr(ingest_graph, "structured", no_llm)
    src = await _ingest(fresh_store, "synthetic_fire_safety_note.txt")
    assert src.kind == "text" and src.status == "ready", src.error
    assert src.chunk_count >= 1 and src.description
    hits = await fresh_store.vector_search([0.0, 0.0, 1.0], 2, [src.id])
    assert hits and "text" in hits[0] and "embedding" not in hits[0]


@pytest.mark.parametrize(
    "label,payload",
    [
        ("cp1252 (legacy Excel/Tableau export)", "id,city,amount\n1,Zürich,3.5\n2,Café,4\n".encode("cp1252")),
        ("utf-8 with BOM", "id,city,amount\n1,Zürich,3.5\n2,Café,4\n".encode("utf-8-sig")),
        ("utf-16 with BOM", "id,city,amount\n1,Zürich,3.5\n2,Café,4\n".encode("utf-16")),
        ("semicolon separated", "id;city;amount\n1;Zürich;3,5\n2;Café;4\n".encode("utf-8")),
        ("tab separated", "id\tcity\tamount\n1\tZürich\t3.5\n2\tCafé\t4\n".encode("utf-8")),
        ("ragged row", "id,city,amount\n1,Zürich,3.5\n2,Café,4\n3,Bern,1,EXTRA,FIELDS\n".encode("utf-8")),
    ],
)
def test_csv_encodings_and_delimiters(label, payload):
    ((_, df),) = parsers.read_tables("t.csv", payload)
    assert list(df.columns) == ["id", "city", "amount"], label
    assert len(df) >= 2 and "Zürich" in set(df["city"]), label


def test_zip_codes_keep_leading_zeros_and_codes_are_not_measures():
    from app.services.schema_infer import infer_table

    ((_, df),) = parsers.read_tables(
        "z.csv", ("zip,Postal Code,sales\n" + "\n".join(f"0{1000 + i},{10000 + i},{i}.5" for i in range(60))).encode()
    )
    _, cols = infer_table(df)
    by = {c.name: c for c in cols}
    assert by["zip"].dtype == "string"
    assert by["Postal Code"].role in ("dimension", "id") and by["sales"].role == "measure"


def test_pack_layout_flows_left_to_right_and_wraps():
    from app.schemas import Widget
    from app.services.widgets import default_layout, pack_layout

    def mk(i, t, span=None):
        return Widget(id=str(i), type=t, title=t, layout=default_layout(t, span))

    ws = [mk(0, "bar"), mk(1, "card"), mk(2, "card"), mk(3, "card"), mk(4, "card"), mk(5, "line", "full")]
    pack_layout(ws)
    pos = {w.id: (w.layout.x, w.layout.y) for w in ws}
    assert [pos[str(i)] for i in (1, 2, 3, 4)] == [(0, 0), (3, 0), (6, 0), (9, 0)]
    assert pos["0"] == (0, 2) and pos["5"][0] == 0 and pos["5"][1] > 2
    assert ws[5].layout.w == 12
    ws2 = [mk(9, "card")]
    pack_layout(ws2, start_y=7)
    assert (ws2[0].layout.x, ws2[0].layout.y) == (0, 7)


async def test_trend_charts_are_never_truncated(fresh_store):
    from app.schemas import WidgetSpec
    from app.services.widgets import as_time_series

    exp = await _ingest(fresh_store, "synthetic_combustion_experiments.csv")
    spec = WidgetSpec(
        type="line", title="t", source_id=exp.id,
        query=QuerySpec(source_id=exp.id, dimensions=[Dimension(column="date", bucket="month")],
                        measures=[Measure(agg="count", alias="n")], limit=5,
                        sort=[{"by": "n", "dir": "desc"}]),
    )
    as_time_series(spec, exp)
    res = await run_query(fresh_store, exp, spec.query)
    months = [r["date"] for r in res.rows]
    assert len(months) > 5 and months == sorted(months)


async def test_kpi_card_gets_trend_series(fresh_store, monkeypatch):
    exp = await _ingest(fresh_store, "synthetic_combustion_experiments.csv")

    async def fake_structured(schema, messages):
        if schema is chat_graph.DataSelection:
            return chat_graph.DataSelection(reasoning="needs the table", needs_tabular=True)
        if schema is chat_graph.Route:
            return chat_graph.Route(intent="dashboard", reasoning="r", needs_data_queries=True, needs_kpis=True)
        if schema is chat_graph.WidgetPlan:
            return chat_graph.WidgetPlan(widgets=[
                chat_graph.PlannedWidget(
                    type="card", title="Runs", source_id=exp.id,
                    query=QuerySpec(source_id=exp.id, measures=[Measure(agg="count", alias="n")]),
                    trend=QuerySpec(source_id=exp.id, dimensions=[Dimension(column="date", bucket="year")],
                                    measures=[Measure(agg="count", alias="n")]),
                ),
                chat_graph.PlannedWidget(
                    type="card", title="Bad trend", source_id=exp.id,
                    query=QuerySpec(source_id=exp.id, measures=[Measure(agg="count", alias="n")]),
                    trend=QuerySpec(source_id=exp.id, measures=[Measure(agg="count", alias="n")]),
                ),
                chat_graph.PlannedWidget(type="line", title="Trend", source_id=exp.id, span="full",
                    query=QuerySpec(source_id=exp.id, dimensions=[Dimension(column="date", bucket="year")],
                                    measures=[Measure(agg="count", alias="n")])),
            ])
        return chat_graph.Synthesis(answer="ok", key_insights=["x"])

    monkeypatch.setattr(chat_graph, "structured", fake_structured)
    out = await chat_graph.get_graph().ainvoke({"request": ChatRequest(message="dash", conversation_id="c"), "user": USER})
    kpi, bad, line, insight = out["response"].widgets
    assert [r["date"] for r in kpi.trend_data.rows] == sorted(r["date"] for r in kpi.trend_data.rows)
    assert sum(r["n"] for r in kpi.trend_data.rows) == kpi.data.rows[0]["n"] == 180
    assert bad.trend is None and bad.trend_data is None and bad.data.rows[0]["n"] == 180
    assert line.layout.w == 12 and insight.type == "insight"
    assert (kpi.layout.x, kpi.layout.y, bad.layout.x, bad.layout.y) == (0, 0, 3, 0)
    assert line.layout.y >= 2


def test_place_name_columns_are_recognised_by_their_values():
    from app.services.geo import detect_kind

    states = ["California", "New York", "Texas", "Washington", "Florida"]
    assert detect_kind("Region_Name", states) == "us_state"
    assert detect_kind("st", ["CA", "NY", "TX", "WA"]) is None
    assert detect_kind("State", ["CA", "NY", "TX", "WA"]) == "us_state"
    assert detect_kind("where", ["United States", "France", "Japan", "Brazil", "UK", "Viet Nam"]) == "country"
    assert detect_kind("Country", ["USA", "FRA", "JPN", "BRA"]) == "country"
    assert detect_kind("City", ["Chicago", "Seattle", "Houston", "Denver", "Zürich", "São Paulo"]) == "city"
    assert detect_kind("Product", ["Binder", "Staples", "Envelope", "Phone", "Chair"]) is None
    assert detect_kind("Segment", ["Consumer", "Corporate", "Home Office"]) is None


def test_resolve_names_to_map_shapes_and_points():
    from app.services.geo import resolve

    st = resolve("us_state", [{"name": "California"}, {"name": "ny"}, {"name": "Atlantis"}])
    assert st[0] == {"id": "06", "label": "California"} and st[1]["id"] == "36" and st[2] is None
    co = resolve("country", [{"name": "United States"}, {"name": "USA"}, {"name": "Viet Nam"}, {"name": "Brasil?"}])
    assert co[0]["id"] == co[1]["id"] == "840" and co[2]["id"] == "704" and co[3] is None
    ci = resolve("city", [{"name": "Springfield", "hint": "Illinois"}, {"name": "Springfield", "hint": "MA"},
                          {"name": "Zürich"}, {"name": "Nowhereville"}])
    assert ci[0]["lat"] != ci[1]["lat"] and 39 < ci[0]["lat"] < 40 and 42 < ci[1]["lat"] < 43
    assert 47 < ci[2]["lat"] < 48 and ci[3] is None


async def test_geo_columns_get_roles_and_a_state_map_is_repaired(fresh_store):
    from app.schemas import QueryResult, ResultColumn, WidgetSpec
    from app.services.widgets import fit_encoding

    csv = ("Order,State,City,Country,Sales,Where\n" + "\n".join(
        f'{i},{s},{c},United States,{10 + i},"{p}"' for i, (s, c, p) in enumerate(
            [("California", "Los Angeles", "34.05, -118.24"), ("Texas", "Houston", "29.76, -95.37"),
             ("New York", "New York City", "40.71, -74.00"), ("Florida", "Miami", "25.76, -80.19"),
             ("Washington", "Seattle", "47.61, -122.33")] * 6)) + "\n").encode()
    ((_, df),) = parsers.read_tables("geo.csv", csv)
    from app.services.schema_infer import infer_table
    _, cols = infer_table(df)
    role = {c.name: c.role for c in cols}
    assert role["State"] == "geo_state" and role["City"] == "geo_city" and role["Country"] == "geo_country"
    assert role["Where (lat)"] == "geo_lat" and role["Where (lon)"] == "geo_lon"

    src = SourceDoc(id="s", kind="tabular", filename="g.csv", name="g", status="ready", columns=cols, row_count=30)
    spec = WidgetSpec(
        type="map", title="Sales by state", source_id="s",
        query=QuerySpec(source_id="s", dimensions=[Dimension(column="State")],
                        measures=[Measure(column="Sales", agg="sum", alias="sales")]),
    )
    res = QueryResult(columns=[ResultColumn(name="State"), ResultColumn(name="sales", dtype="float")],
                      rows=[{"State": "Texas", "sales": 5.0}])
    assert fit_encoding(spec, res, src) == []
    e = spec.encoding
    assert (e.geo, e.location, e.value) == ("us_state", "State", "sales")

    spec2 = WidgetSpec(type="map", title="cities", source_id="s", query=QuerySpec(
        source_id="s", dimensions=[Dimension(column="City"), Dimension(column="State")],
        measures=[Measure(column="Sales", agg="sum", alias="sales")]))
    res2 = QueryResult(columns=[ResultColumn(name="City"), ResultColumn(name="State"), ResultColumn(name="sales", dtype="float")], rows=[])
    assert fit_encoding(spec2, res2, src) == []
    assert (spec2.encoding.geo, spec2.encoding.location, spec2.encoding.region) == ("city", "City", "State")
    spec3 = WidgetSpec(type="map", title="pts", source_id="s", query=QuerySpec(source_id="s", select=["Where (lat)", "Where (lon)", "Sales"]))
    res3 = QueryResult(columns=[ResultColumn(name="Where (lat)", dtype="float"), ResultColumn(name="Where (lon)", dtype="float"),
                                ResultColumn(name="Sales", dtype="float")], rows=[])
    assert fit_encoding(spec3, res3, src) == [] and spec3.encoding.geo == "lat_lon"
    spec4 = WidgetSpec(type="map", title="x", source_id="s", query=QuerySpec(source_id="s", select=["Order", "Sales"]))
    res4 = QueryResult(columns=[ResultColumn(name="Order"), ResultColumn(name="Sales", dtype="float")], rows=[])
    assert "place column" in fit_encoding(spec4, res4, src)[0]


def test_fit_encoding_repairs_swapped_bar_channels():
    from app.schemas import QueryResult, ResultColumn, WidgetSpec
    from app.services.widgets import fit_encoding

    spec = WidgetSpec(
        type="bar", title="t", source_id="s",
        query=QuerySpec(source_id="s", dimensions=[Dimension(column="fuel")],
                        measures=[Measure(column="v", agg="avg", alias="avg_v")]),
        encoding=Encoding(x="avg_v", y=["fuel"]),
    )
    res = QueryResult(columns=[ResultColumn(name="fuel"), ResultColumn(name="avg_v", dtype="float")],
                      rows=[{"fuel": "PMMA", "avg_v": 1.0}])
    assert fit_encoding(spec, res, None) == []
    assert spec.encoding.x == "fuel" and spec.encoding.y == ["avg_v"]


def test_chunker_respects_size_and_overlap():
    text = "\n\n".join(f"Paragraph {i} " + "word " * 60 for i in range(10))
    chunks = parsers.chunk_text(text, 500, 80)
    assert len(chunks) > 3 and all(len(c) <= 700 for c in chunks)


async def test_unsupported_file_marks_failure(fresh_store):
    doc = SourceDoc(id="x1", kind="text", filename="a.bin", name="a.bin")
    await fresh_store.upsert("sources", doc.model_dump())
    await ingest_graph.run_ingest("x1", "a.bin", b"123")
    assert (await fresh_store.get("sources", "x1"))["status"] == "failed"


async def test_chat_graph_with_scripted_llm(fresh_store, monkeypatch):
    exp = await _ingest(fresh_store, "synthetic_combustion_experiments.csv")

    calls = []

    async def fake_structured(schema, messages):
        calls.append(schema.__name__)
        if schema is chat_graph.DataSelection:
            return chat_graph.DataSelection(reasoning="needs the table", needs_tabular=True, tabular_source_ids=[exp.id])
        if schema is chat_graph.Route:
            return chat_graph.Route(
                intent="dashboard", reasoning="build overview", needs_data_queries=True, needs_kpis=True,
                source_ids=[exp.id],
            )
        if schema is chat_graph.WidgetPlan:
            attempt = calls.count("WidgetPlan")
            col = "oxygen_pct" if attempt > 1 else "does_not_exist"
            return chat_graph.WidgetPlan(
                dashboard_title="Combustion overview",
                widgets=[
                    chat_graph.PlannedWidget(
                        type="card", title="Avg flame speed", source_id=exp.id,
                        query=QuerySpec(source_id=exp.id, measures=[Measure(column="flame_speed_mm_s", agg="avg", alias="v")]),
                    ),
                    chat_graph.PlannedWidget(
                        type="bar", title="Speed by fuel", source_id=exp.id,
                        query=QuerySpec(source_id=exp.id, dimensions=[Dimension(column="fuel")],
                                        measures=[Measure(column=col, agg="avg", alias="o2")]),
                    ),
                    chat_graph.PlannedWidget(type="slicer", title="Fuel", source_id=exp.id, slicer_column="fuel"),
                ],
            )
        return chat_graph.Synthesis(answer="Here you go", key_insights=["PMMA is fastest"], suggestions=["a", "b"])

    monkeypatch.setattr(chat_graph, "structured", fake_structured)
    req = ChatRequest(message="Give me an overview", conversation_id="c1")
    out = await chat_graph.get_graph().ainvoke({"request": req, "user": USER})
    res = out["response"]
    assert calls.index("DataSelection") < calls.index("Route"), "the data selector runs before the router"
    assert calls.count("WidgetPlan") == 2, "should retry the planner once after a failed query"
    assert res.dashboard_action == "replace" and res.dashboard_title == "Combustion overview"
    types = [w.type for w in res.widgets]
    assert types == ["card", "bar", "slicer", "insight"]
    bar = res.widgets[1]
    assert bar.encoding.x == "fuel" and bar.encoding.y == ["o2"] and bar.data.rows
    assert res.widgets[2].slicer_mode == "list"


async def test_no_data_routes_to_general(fresh_store, monkeypatch):
    async def fake_structured(schema, messages):
        assert schema is chat_graph.Synthesis
        return chat_graph.Synthesis(answer="Upload a file first")

    monkeypatch.setattr(chat_graph, "structured", fake_structured)
    out = await chat_graph.get_graph().ainvoke({"request": ChatRequest(message="hi"), "user": USER})
    assert out["response"].intent == "general" and not out["response"].widgets
