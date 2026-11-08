from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal

from pydantic import BaseModel, Field

ColumnType = Literal["string", "integer", "float", "boolean", "date", "datetime"]
ColumnRole = Literal[
    "dimension", "measure", "date", "geo_lat", "geo_lon", "geo_country", "geo_state", "geo_city", "id", "text"
]


def utcnow() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class ColumnSchema(BaseModel):
    name: str
    dtype: ColumnType = "string"
    role: ColumnRole = "dimension"
    description: str = ""
    null_count: int = 0
    distinct_count: int = 0
    top_values: list[Any] = Field(default_factory=list)
    min: Any = None
    max: Any = None
    mean: float | None = None


class Relationship(BaseModel):
    id: str
    from_source: str
    from_column: str
    to_source: str
    to_column: str
    kind: Literal["auto", "manual"] = "auto"


class SourceDoc(BaseModel):
    id: str
    kind: Literal["tabular", "text"]
    filename: str
    name: str = ""
    status: Literal["processing", "ready", "failed", "deleting"] = "processing"
    stage: str = "queued"
    error: str | None = None
    warnings: list[str] = Field(default_factory=list)
    created_at: str = Field(default_factory=utcnow)
    description: str = ""
    geo_version: int = 0
    row_count: int = 0
    columns: list[ColumnSchema] = Field(default_factory=list)
    chunk_count: int = 0
    page_count: int = 0
    topics: list[str] = Field(default_factory=list)
    # ownership: "private" sources belong to owner_id alone, "global" ones are readable by everyone
    visibility: Literal["private", "global"] = "private"
    owner_id: str | None = None
    owner_name: str = ""
    conversation_id: str | None = None
    size_bytes: int = 0


Role = Literal["admin", "client"]
KbScope = Literal["all", "local", "global"]


class UsageStats(BaseModel):
    prompts: int = 0
    sessions: int = 0
    tokens_in: int = 0
    tokens_out: int = 0
    tokens_total: int = 0
    flagged: int = 0
    uploads: int = 0


class UserDoc(BaseModel):
    """Stored user record. `password_hash` never leaves the API."""

    id: str
    name: str
    email: str
    role: Role = "client"
    password_hash: str
    active: bool = True
    must_change_password: bool = False
    token_version: int = 0
    created_at: str = Field(default_factory=utcnow)
    created_by: str | None = None
    last_login: str | None = None
    last_active: str | None = None
    usage: UsageStats = Field(default_factory=UsageStats)


class UserPublic(BaseModel):
    id: str
    name: str
    email: str
    role: Role
    active: bool = True
    must_change_password: bool = False
    created_at: str = ""
    last_active: str | None = None

    @classmethod
    def of(cls, u: UserDoc) -> "UserPublic":
        return cls(
            id=u.id, name=u.name, email=u.email, role=u.role, active=u.active,
            must_change_password=u.must_change_password, created_at=u.created_at, last_active=u.last_active,
        )


class FlagDoc(BaseModel):
    """A chat prompt the safety node flagged, kept for administrator review."""

    id: str
    user_id: str
    user_name: str
    user_email: str = ""
    conversation_id: str = ""
    created_at: str = Field(default_factory=utcnow)
    prompt: str
    response: str = ""
    categories: list[str] = Field(default_factory=list)
    severity: Literal["low", "medium", "high"] = "medium"
    reason: str = ""
    blocked: bool = True
    detection: str = "llm"
    reviewed: bool = False
    reviewed_by: str | None = None
    reviewed_at: str | None = None


FilterOp = Literal["eq", "neq", "in", "not_in", "gt", "gte", "lt", "lte", "between", "contains"]
Agg = Literal["sum", "avg", "min", "max", "count", "count_distinct", "median"]
Bucket = Literal["day", "week", "month", "quarter", "year"]


class Filter(BaseModel):
    column: str
    op: FilterOp = "eq"
    value: Any = None


class ActiveFilter(Filter):
    """A filter set by the user in the dashboard (slicer or cross-filter click)."""

    source_id: str
    origin_widget_id: str | None = None


class Dimension(BaseModel):
    column: str
    bucket: Bucket | None = None
    alias: str | None = None


class Measure(BaseModel):
    column: str | None = None
    agg: Agg = "sum"
    alias: str


class Sort(BaseModel):
    by: str
    dir: Literal["asc", "desc"] = "desc"


class QuerySpec(BaseModel):
    source_id: str
    dimensions: list[Dimension] = Field(default_factory=list)
    measures: list[Measure] = Field(default_factory=list)
    select: list[str] = Field(default_factory=list)
    filters: list[Filter] = Field(default_factory=list)
    sort: list[Sort] = Field(default_factory=list)
    limit: int | None = None


class ResultColumn(BaseModel):
    name: str
    dtype: ColumnType = "string"


class QueryResult(BaseModel):
    columns: list[ResultColumn] = Field(default_factory=list)
    rows: list[dict[str, Any]] = Field(default_factory=list)
    total_rows: int = 0
    truncated: bool = False


class QueryRequest(BaseModel):
    spec: QuerySpec
    slicers: list[ActiveFilter] = Field(default_factory=list)
    exclude_origin: str | None = None


WidgetType = Literal[
    "card", "bar", "column", "stacked_bar", "stacked_column", "line", "area",
    "pie", "donut", "scatter", "bubble", "heatmap", "treemap", "funnel",
    "gauge", "radar", "table", "matrix", "map", "slicer", "insight",
]
SlicerMode = Literal["dropdown", "list", "range", "date_range"]


class Encoding(BaseModel):
    """Maps visual channels to the *output column names* of the widget query."""

    x: str | None = None
    y: list[str] = Field(default_factory=list)
    series: str | None = None
    category: str | None = None
    value: str | None = None
    size: str | None = None
    lat: str | None = None
    lon: str | None = None
    location: str | None = None
    region: str | None = None
    geo: Literal["lat_lon", "country", "us_state", "city"] | None = None
    label: str | None = None
    rows: str | None = None
    columns: str | None = None


class Layout(BaseModel):
    w: int = Field(6, ge=1, le=12)
    h: int = Field(4, ge=1, le=16)
    x: int = Field(0, ge=0, le=11)
    y: int = Field(0, ge=0)


class WidgetSpec(BaseModel):
    type: WidgetType
    title: str
    subtitle: str | None = None
    source_id: str | None = None
    query: QuerySpec | None = None
    trend: QuerySpec | None = None
    encoding: Encoding = Field(default_factory=Encoding)
    options: dict[str, Any] = Field(default_factory=dict)
    layout: Layout = Field(default_factory=Layout)
    slicer_column: str | None = None
    slicer_mode: SlicerMode | None = None
    content: str | None = None
    cross_filter: bool = True
    replaces: str | None = None


class Widget(WidgetSpec):
    id: str
    data: QueryResult | None = None
    trend_data: QueryResult | None = None
    error: str | None = None


class Dashboard(BaseModel):
    title: str = "Dashboard"
    widgets: list[Widget] = Field(default_factory=list)


class Sheet(BaseModel):
    """A saved dashboard page. Widget data is never stored: it is re-queried on open."""

    id: str
    owner_id: str | None = None
    name: str = "Sheet"
    widgets: list[Widget] = Field(default_factory=list)
    filters: list[ActiveFilter] = Field(default_factory=list)
    created_at: str = Field(default_factory=utcnow)
    updated_at: str = Field(default_factory=utcnow)


class SheetInfo(BaseModel):
    id: str
    name: str
    widget_count: int
    updated_at: str


class SheetUpsert(BaseModel):
    name: str = "Sheet"
    widgets: list[Widget] = Field(default_factory=list)
    filters: list[ActiveFilter] = Field(default_factory=list)


class ChatRequest(BaseModel):
    message: str
    conversation_id: str | None = None
    dashboard: Dashboard | None = None
    filters: list[ActiveFilter] = Field(default_factory=list)
    kb_scope: KbScope = "all"
    attachment_ids: list[str] = Field(default_factory=list)


class Citation(BaseModel):
    source_id: str
    filename: str
    page: int | None = None
    chunk_index: int = 0
    snippet: str
    score: float | None = None


class ChatResponse(BaseModel):
    conversation_id: str
    message: str
    intent: str = "general"
    reasoning: str = ""
    dashboard_action: Literal["replace", "append", "remove", "none"] = "none"
    dashboard_title: str | None = None
    widgets: list[Widget] = Field(default_factory=list)
    remove_widget_ids: list[str] = Field(default_factory=list)
    citations: list[Citation] = Field(default_factory=list)
    suggestions: list[str] = Field(default_factory=list)
    blocked: bool = False
    trace: list[dict[str, Any]] = Field(default_factory=list)
    title: str | None = None
