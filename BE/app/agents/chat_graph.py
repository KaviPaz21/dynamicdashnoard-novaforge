from __future__ import annotations

import uuid
from typing import Any, Literal, TypedDict

from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.graph import END, StateGraph
from pydantic import BaseModel, Field

from app.agents import prompts
from app.config import get_settings
from app.db.store import get_store
from app.llm import embed_query, structured
from app.schemas import (
    ChatRequest,
    ChatResponse,
    Citation,
    Encoding,
    QueryResult,
    QuerySpec,
    Relationship,
    SourceDoc,
    Widget,
    WidgetSpec,
    WidgetType,
    SlicerMode,
    Sort,
)
from app.services.filters import QueryError
from app.services.query_engine import run_query
from app.services.semantic import load_relationships
from app.services.widgets import as_time_series, default_layout, default_slicer_mode, fit_encoding, pack_layout

MAX_ATTEMPTS = 2
MAX_WIDGETS = 10


class Route(BaseModel):
    intent: Literal["dashboard", "modify_dashboard", "data_analysis", "document_qa", "hybrid", "general"]
    reasoning: str = Field(description="One sentence: what the user wants and why this routing")
    needs_data_queries: bool = False
    needs_kpis: bool = False
    needs_documents: bool = False
    source_ids: list[str] = Field(default_factory=list)
    dashboard_action: Literal["replace", "append", "remove", "none"] = "none"
    remove_widget_ids: list[str] = Field(default_factory=list)
    doc_query: str | None = None
    clarification: str | None = None


class WidgetOptions(BaseModel):
    format: Literal["number", "compact", "percent", "currency", "duration"] | None = None
    unit: str | None = None
    decimals: int | None = None
    max: float | None = Field(None, description="Upper bound for gauges")


class PlannedWidget(BaseModel):
    type: WidgetType
    title: str
    subtitle: str | None = None
    source_id: str = Field(description="Table id from the catalog")
    query: QuerySpec | None = Field(None, description="Omit for slicer widgets")
    trend: QuerySpec | None = Field(
        None,
        description="KPI cards only: same measure by a date bucket (exactly one date dimension, sorted ascending, "
        "no limit) for the sparkline and the change vs the previous period",
    )
    span: Literal["third", "half", "two_thirds", "full"] | None = Field(
        None, description="Width on the 12-column canvas for charts/tables: third=4, half=6, two_thirds=8, full=12"
    )
    encoding: Encoding = Field(default_factory=Encoding)
    options: WidgetOptions = Field(default_factory=WidgetOptions)
    slicer_column: str | None = None
    slicer_mode: SlicerMode | None = None
    replaces: str | None = Field(None, description="Id of an existing dashboard widget this replaces")


class AnalysisQuery(BaseModel):
    purpose: str
    query: QuerySpec


class WidgetPlan(BaseModel):
    dashboard_title: str | None = None
    widgets: list[PlannedWidget] = Field(default_factory=list)
    analysis_queries: list[AnalysisQuery] = Field(default_factory=list)


class Synthesis(BaseModel):
    answer: str = Field(description="Markdown reply to the user")
    key_insights: list[str] = Field(default_factory=list)
    suggestions: list[str] = Field(default_factory=list)


class ChatState(TypedDict, total=False):
    request: ChatRequest
    history: list[dict[str, Any]]
    sources: list[SourceDoc]
    relationships: list[Relationship]
    catalog: str
    route: Route
    plan: WidgetPlan
    attempts: int
    errors: list[str]
    failed: list[str]
    widgets: list[Widget]
    analysis: list[dict[str, Any]]
    chunks: list[dict[str, Any]]
    response: ChatResponse


async def load_context(state: ChatState) -> ChatState:
    store = await get_store()
    req = state["request"]
    sources = [SourceDoc(**d) for d in await store.list_all("sources")]
    sources.sort(key=lambda s: s.created_at)
    rels = await load_relationships(store)
    history: list[dict[str, Any]] = []
    if req.conversation_id:
        conv = await store.get("conversations", req.conversation_id)
        history = (conv or {}).get("messages", [])
    return {
        "sources": sources,
        "relationships": rels,
        "history": history,
        "catalog": prompts.render_catalog(sources, rels),
        "attempts": 0,
        "errors": [],
        "failed": [],
        "widgets": [],
        "analysis": [],
        "chunks": [],
    }


async def route(state: ChatState) -> ChatState:
    req, sources = state["request"], state["sources"]
    ready = [s for s in sources if s.status == "ready"]
    tabular = {s.id for s in ready if s.kind == "tabular"}
    texts = {s.id for s in ready if s.kind == "text"}

    if not ready:
        return {"route": Route(intent="general", reasoning="No data uploaded yet")}

    msg = [
        SystemMessage(content=prompts.ROUTER_SYSTEM.format(domain=prompts.domain())),
        HumanMessage(
            content=f"CATALOG\n{state['catalog']}\n\nCURRENT DASHBOARD\n{prompts.render_dashboard(req)}\n\n"
            f"CONVERSATION SO FAR\n{prompts.render_history(state['history'])}\n\nUSER MESSAGE\n{req.message}"
        ),
    ]
    r = await structured(Route, msg)

    scope = set(req.source_ids)
    r.source_ids = [i for i in r.source_ids if i in tabular | texts]
    if scope:
        r.source_ids = [i for i in (r.source_ids or list(scope)) if i in scope]
    r.needs_data_queries = r.needs_data_queries and bool(tabular)
    r.needs_documents = r.needs_documents and bool(texts)
    if r.intent in ("dashboard", "modify_dashboard") and r.dashboard_action != "remove" and tabular:
        r.needs_data_queries = r.needs_kpis = True
    if not r.needs_data_queries:
        r.needs_kpis = False
    current = {w.id for w in (req.dashboard.widgets if req.dashboard else [])}
    r.remove_widget_ids = [i for i in r.remove_widget_ids if i in current]
    if r.dashboard_action == "remove" and not r.remove_widget_ids:
        r.dashboard_action = "none"
    if r.needs_kpis and r.dashboard_action == "none":
        r.dashboard_action = "append" if current else "replace"
    return {"route": r}


def after_route(state: ChatState) -> str:
    r = state["route"]
    if r.clarification:
        return "synthesize"
    if r.needs_data_queries:
        return "plan_widgets"
    if r.needs_documents:
        return "retrieve_docs"
    return "synthesize"


async def plan_widgets(state: ChatState) -> ChatState:
    req, r = state["request"], state["route"]
    scope = ""
    if r.source_ids:
        scope = f"\nRelevant sources (prefer these): {', '.join(r.source_ids)}"
    feedback = ""
    if state["errors"]:
        feedback = (
            "\n\nYOUR PREVIOUS PLAN FAILED. Fix these problems and return a corrected full plan:\n- "
            + "\n- ".join(state["errors"])
        )
    msg = [
        SystemMessage(content=prompts.PLANNER_SYSTEM.format(domain=prompts.domain())),
        HumanMessage(
            content=f"CATALOG\n{state['catalog']}{scope}\n\nCURRENT DASHBOARD\n{prompts.render_dashboard(req)}\n\n"
            f"CONVERSATION SO FAR\n{prompts.render_history(state['history'])}\n\n"
            f"Routing: intent={r.intent}, dashboard_action={r.dashboard_action}, needs_kpis={r.needs_kpis}\n"
            f"USER REQUEST\n{req.message}{feedback}"
        ),
    ]
    plan = await structured(WidgetPlan, msg)
    plan.widgets = plan.widgets[:MAX_WIDGETS]
    return {"plan": plan, "attempts": state["attempts"] + 1}


async def _exec(spec: QuerySpec, state: ChatState, by_id: dict[str, SourceDoc]) -> QueryResult:
    src = by_id.get(spec.source_id)
    if src is None:
        raise QueryError(f"Unknown table id {spec.source_id!r}")
    store = await get_store()
    return await run_query(store, src, spec, state["request"].filters, state["relationships"])


async def execute_queries(state: ChatState) -> ChatState:
    plan, r, req = state["plan"], state["route"], state["request"]
    by_id = {s.id: s for s in state["sources"] if s.status == "ready"}
    existing = {w.id: w for w in (req.dashboard.widgets if req.dashboard else [])}
    widgets: list[Widget] = []
    errors: list[str] = []

    for pw in plan.widgets:
        try:
            if pw.source_id not in by_id and pw.query:
                pw.source_id = pw.query.source_id
            src = by_id.get(pw.source_id)
            if src is None:
                raise QueryError(f"Unknown table id {pw.source_id!r}")
            spec = WidgetSpec(
                type=pw.type, title=pw.title, subtitle=pw.subtitle, source_id=pw.source_id,
                query=pw.query, trend=pw.trend if pw.type == "card" else None, encoding=pw.encoding,
                options={k: v for k, v in pw.options.model_dump().items() if v is not None},
                slicer_column=pw.slicer_column, slicer_mode=pw.slicer_mode,
                replaces=pw.replaces if pw.replaces in existing else None,
                layout=default_layout(pw.type, pw.span),
            )
            if spec.replaces:
                spec.layout = existing[spec.replaces].layout
            widget = Widget(id=f"w_{uuid.uuid4().hex[:8]}", **spec.model_dump())

            if pw.type == "slicer":
                if not any(c.name == pw.slicer_column for c in src.columns):
                    raise QueryError(f"Slicer column {pw.slicer_column!r} not in {src.name!r}")
                widget.slicer_mode = pw.slicer_mode or default_slicer_mode(widget, src)
                widget.query = None
                if widget.slicer_mode == "list" and not spec.replaces:
                    widget.layout.h = 4
            else:
                if widget.query is None:
                    raise QueryError("widget has no query")
                widget.query.source_id = src.id
                as_time_series(widget, src)
                widget.data = await _exec(widget.query, state, by_id)
                problems = fit_encoding(widget, widget.data, src)
                if problems:
                    raise QueryError("; ".join(problems))
                if widget.trend:
                    widget.trend.source_id = src.id
                    try:
                        if len(widget.trend.dimensions) != 1 or not widget.trend.measures:
                            raise QueryError("trend needs one date dimension and a measure")
                        widget.trend.sort = [Sort(by=widget.trend.dimensions[0].alias or widget.trend.dimensions[0].column, dir="asc")]
                        widget.trend.limit = None
                        widget.trend_data = await _exec(widget.trend, state, by_id)
                    except Exception:
                        widget.trend = widget.trend_data = None
            widgets.append(widget)
        except Exception as e:
            errors.append(f'widget "{pw.title}" ({pw.type}): {e}')

    analysis: list[dict[str, Any]] = []
    for aq in plan.analysis_queries[:4]:
        try:
            analysis.append({"purpose": aq.purpose, "result": await _exec(aq.query, state, by_id)})
        except Exception as e:
            errors.append(f'analysis query "{aq.purpose}": {e}')

    return {"widgets": widgets, "analysis": analysis, "errors": errors, "failed": errors if state["attempts"] >= MAX_ATTEMPTS else []}


def after_execute(state: ChatState) -> str:
    if state["errors"] and state["attempts"] < MAX_ATTEMPTS:
        return "plan_widgets"
    return "retrieve_docs" if state["route"].needs_documents else "synthesize"


async def retrieve_docs(state: ChatState) -> ChatState:
    r, req = state["route"], state["request"]
    store = await get_store()
    texts = {s.id: s for s in state["sources"] if s.kind == "text" and s.status == "ready"}
    ids = [i for i in r.source_ids if i in texts] or list(texts)
    vec = await embed_query(r.doc_query or req.message)
    hits = await store.vector_search(vec, get_settings().rag_top_k, ids)
    for h in hits:
        h["filename"] = texts[h["source_id"]].filename if h["source_id"] in texts else ""
    return {"chunks": hits}


async def synthesize(state: ChatState) -> ChatState:
    req, r = state["request"], state["route"]
    widgets: list[Widget] = state.get("widgets", [])
    sections: list[str] = []
    for w in widgets:
        if w.data:
            sections.append(prompts.render_result(f'[widget] {w.title} ({w.type})', w.data))
    for a in state.get("analysis", []):
        sections.append(prompts.render_result(f'[analysis] {a["purpose"]}', a["result"]))
    chunks = state.get("chunks", [])
    excerpts = "\n\n".join(
        f'[{i + 1}] ({c.get("filename", "")}{", p." + str(c["page"]) if c.get("page") else ""}) {c["text"]}'
        for i, c in enumerate(chunks)
    )
    notes = []
    if state.get("failed"):
        notes.append("COULD NOT BUILD:\n- " + "\n- ".join(state["failed"]))
    if req.filters:
        notes.append("The user currently has dashboard filters applied; results already reflect them.")
    if r.clarification:
        notes.append(f"Ask the user this clarifying question: {r.clarification}")
    if r.dashboard_action == "remove":
        notes.append(f"Removed widgets: {', '.join(r.remove_widget_ids)}.")

    msg = [
        SystemMessage(content=prompts.SYNTH_SYSTEM.format(domain=prompts.domain())),
        HumanMessage(
            content=f"CATALOG\n{state['catalog']}\n\nCONVERSATION SO FAR\n{prompts.render_history(state['history'])}\n\n"
            f"USER MESSAGE\n{req.message}\n\nINTENT: {r.intent} - {r.reasoning}\n\n"
            f"QUERY RESULTS\n{chr(10).join(sections) or '(none)'}\n\nDOCUMENT EXCERPTS\n{excerpts or '(none)'}\n\n"
            + "\n".join(notes)
        ),
    ]
    out = await structured(Synthesis, msg)

    ok_widgets = [w for w in widgets if w.type != "slicer" or w.slicer_column]
    if ok_widgets and r.needs_kpis and out.key_insights:
        ok_widgets.append(
            Widget(
                id=f"w_{uuid.uuid4().hex[:8]}", type="insight", title="Key insights",
                content="\n".join(f"- {i}" for i in out.key_insights), layout=default_layout("insight"),
            )
        )
    below = 0
    if r.dashboard_action == "append" and req.dashboard:
        below = max((w.layout.y + w.layout.h for w in req.dashboard.widgets), default=0)
    pack_layout(ok_widgets, below)
    title = (state.get("plan").dashboard_title if state.get("plan") else None) or None
    return {
        "response": ChatResponse(
            conversation_id=req.conversation_id or "",
            message=out.answer,
            intent=r.intent,
            reasoning=r.reasoning,
            dashboard_action=r.dashboard_action if (ok_widgets or r.dashboard_action == "remove") else "none",
            dashboard_title=title,
            widgets=ok_widgets,
            remove_widget_ids=r.remove_widget_ids,
            citations=[
                Citation(
                    source_id=c["source_id"], filename=c.get("filename", ""), page=c.get("page"),
                    chunk_index=c.get("chunk_index", 0), snippet=c["text"][:400], score=c.get("score"),
                )
                for c in chunks
            ],
            suggestions=out.suggestions[:3],
        )
    }


def build_graph():
    g = StateGraph(ChatState)
    g.add_node("load_context", load_context)
    g.add_node("route", route)
    g.add_node("plan_widgets", plan_widgets)
    g.add_node("execute_queries", execute_queries)
    g.add_node("retrieve_docs", retrieve_docs)
    g.add_node("synthesize", synthesize)
    g.set_entry_point("load_context")
    g.add_edge("load_context", "route")
    g.add_conditional_edges("route", after_route, ["plan_widgets", "retrieve_docs", "synthesize"])
    g.add_edge("plan_widgets", "execute_queries")
    g.add_conditional_edges("execute_queries", after_execute, ["plan_widgets", "retrieve_docs", "synthesize"])
    g.add_edge("retrieve_docs", "synthesize")
    g.add_edge("synthesize", END)
    return g.compile()


_graph = None


def get_graph():
    global _graph
    _graph = _graph or build_graph()
    return _graph
