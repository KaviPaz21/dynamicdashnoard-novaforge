from __future__ import annotations

from app.schemas import Layout, QueryResult, SourceDoc, Sort, WidgetSpec

DEFAULT_LAYOUT: dict[str, tuple[int, int]] = {
    "card": (3, 2), "gauge": (3, 3), "slicer": (3, 2), "insight": (12, 2),
    "bar": (6, 4), "column": (6, 4), "stacked_bar": (6, 4), "stacked_column": (6, 4),
    "line": (6, 4), "area": (6, 4), "pie": (4, 4), "donut": (4, 4), "scatter": (6, 4),
    "bubble": (6, 4), "heatmap": (6, 4), "treemap": (6, 4), "funnel": (4, 4), "radar": (4, 4),
    "table": (12, 5), "matrix": (12, 5), "map": (6, 5),
}
SPAN_COLUMNS = {"third": 4, "half": 6, "two_thirds": 8, "full": 12}
_RANK = {"card": 0, "gauge": 0, "slicer": 1, "table": 3, "matrix": 3, "insight": 4}

_NUMERIC = ("integer", "float")
_CATEGORY = ("string", "date", "datetime", "boolean")


def default_layout(wtype: str, span: str | None = None) -> Layout:
    w, h = DEFAULT_LAYOUT.get(wtype, (6, 4))
    if span in SPAN_COLUMNS and wtype not in ("card", "gauge", "slicer"):
        w = SPAN_COLUMNS[span]
    return Layout(w=w, h=h)


def pack_layout(widgets: list, start_y: int = 0) -> None:
    x = row_h = 0
    y = start_y
    for w in sorted(widgets, key=lambda w: _RANK.get(w.type, 2)):
        if w.replaces:
            continue
        if x + w.layout.w > 12:
            x, y, row_h = 0, y + row_h, 0
        w.layout.x, w.layout.y = x, y
        x += w.layout.w
        row_h = max(row_h, w.layout.h)


def as_time_series(spec: WidgetSpec, source: SourceDoc) -> None:
    q = spec.query
    if spec.type not in ("line", "area") or not q or not q.dimensions:
        return
    first = q.dimensions[0]
    col = next((c for c in source.columns if c.name == first.column), None)
    if first.bucket or (col and col.dtype in ("date", "datetime")):
        q.sort = [Sort(by=first.alias or first.column, dir="asc")]
        q.limit = None


def default_slicer_mode(spec: WidgetSpec, source: SourceDoc) -> str:
    col = next((c for c in source.columns if c.name == spec.slicer_column), None)
    if col is None:
        return "dropdown"
    if col.dtype in ("date", "datetime"):
        return "date_range"
    if col.dtype in _NUMERIC and col.role == "measure":
        return "range"
    return "list" if col.distinct_count <= 8 else "dropdown"


def fit_encoding(spec: WidgetSpec, result: QueryResult, source: SourceDoc | None) -> list[str]:
    names = [c.name for c in result.columns]
    dtype = {c.name: c.dtype for c in result.columns}
    q = spec.query
    if q and (q.dimensions or q.measures):
        dims = [d.alias or d.column for d in q.dimensions]
        measures = [m.alias for m in q.measures]
    else:
        dims = [n for n in names if dtype[n] in _CATEGORY]
        measures = [n for n in names if dtype[n] in _NUMERIC]

    e = spec.encoding
    valid = lambda n: n is not None and n in names  # noqa: E731

    e.x = e.x if valid(e.x) else None
    e.y = [c for c in e.y if valid(c)]
    for f in ("series", "category", "value", "size", "lat", "lon", "location", "region", "label", "rows", "columns"):
        if not valid(getattr(e, f)):
            setattr(e, f, None)

    t = spec.type
    problems: list[str] = []

    if t in ("bar", "column", "stacked_bar", "stacked_column", "line", "area"):
        if e.x in measures and e.y and not set(e.y) & set(measures):
            e.x, e.y = e.y[0], [e.x]
        e.x = e.x or (dims[0] if dims else names[0] if names else None)
        e.y = e.y or [m for m in measures if m != e.x] or [n for n in names if n != e.x][:1]
        if not e.series and len(dims) > 1:
            e.series = next((d for d in dims if d != e.x), None)
        if not e.x or not e.y:
            problems.append("needs one category/time column and at least one measure")
    elif t == "radar":
        e.category = e.category or e.x or (dims[0] if dims else None)
        e.y = e.y or measures
        if not e.category or not e.y:
            problems.append("radar needs a category and at least one measure")
    elif t in ("pie", "donut", "funnel", "treemap"):
        e.category = e.category or e.x or (dims[0] if dims else None)
        e.value = e.value or (e.y[0] if e.y else None) or (measures[0] if measures else None)
        if not e.category or not e.value:
            problems.append(f"{t} needs one category and one measure")
    elif t in ("scatter", "bubble"):
        nums = [n for n in names if dtype[n] in _NUMERIC]
        e.x = e.x or (nums[0] if nums else None)
        if not e.y:
            e.y = [next((n for n in nums if n != e.x), "")] if len(nums) > 1 else []
            e.y = [c for c in e.y if c]
        if t == "bubble" and not e.size:
            e.size = next((n for n in nums if n != e.x and n not in e.y), None)
        if not e.x or not e.y:
            problems.append("scatter needs two numeric columns")
    elif t == "heatmap":
        e.x = e.x or (dims[0] if dims else None)
        e.series = e.series or next((d for d in dims if d != e.x), None)
        e.value = e.value or (measures[0] if measures else None)
        if not (e.x and e.series and e.value):
            problems.append("heatmap needs two dimensions and one measure")
    elif t == "matrix":
        e.rows = e.rows or (dims[0] if dims else None)
        e.columns = e.columns or next((d for d in dims if d != e.rows), None)
        e.value = e.value or (measures[0] if measures else None)
        if not (e.rows and e.value):
            problems.append("matrix needs a row field and a measure")
    elif t in ("card", "gauge"):
        e.value = e.value or (measures[0] if measures else None) or next(
            (n for n in names if dtype[n] in _NUMERIC), None
        )
        if not e.value:
            problems.append(f"{t} needs a measure")
    elif t == "map":
        problems += _fit_map(e, names, dims, measures, q, source)
    return problems


_GEO_KIND = {"geo_state": "us_state", "geo_country": "country", "geo_city": "city"}


def _fit_map(e, names, dims, measures, q, source) -> list[str]:
    by_col = {c.name: c.role for c in source.columns} if source else {}
    role_of = {n: by_col.get(n) for n in names}
    if q:
        for d in q.dimensions:
            role_of[d.alias or d.column] = by_col.get(d.column)

    e.lat = e.lat or next((n for n in names if role_of.get(n) == "geo_lat"), None)
    e.lon = e.lon or next((n for n in names if role_of.get(n) == "geo_lon"), None)
    e.value = e.value or e.size or (measures[0] if measures else None)
    e.size = e.value

    if e.lat and e.lon:
        e.geo = "lat_lon"
        e.label = e.label or e.location or (dims[0] if dims else None)
        return []

    loc = e.location if role_of.get(e.location) in _GEO_KIND else None
    loc = loc or next((n for n in names if role_of.get(n) in _GEO_KIND), None)
    if not loc:
        return ["map needs latitude+longitude columns or a place column (country, state or city)"]
    e.location, e.geo = loc, _GEO_KIND[role_of[loc]]
    e.label = e.label or loc
    e.region = None
    if e.geo == "city":
        e.region = next((n for n in names if n != loc and role_of.get(n) in ("geo_state", "geo_country")), None)
    return []
