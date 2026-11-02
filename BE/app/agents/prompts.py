from __future__ import annotations

import json
from typing import Any

from app.config import get_settings
from app.schemas import ChatRequest, QueryResult, Relationship, SourceDoc


def _fmt(v: Any) -> str:
    return json.dumps(v, default=str, ensure_ascii=False)


def render_catalog(sources: list[SourceDoc], rels: list[Relationship]) -> str:
    ready = [s for s in sources if s.status == "ready"]
    if not ready:
        return "(no data has been uploaded yet)"
    by_id = {s.id: s for s in ready}
    lines: list[str] = []
    for s in ready:
        if s.kind == "tabular":
            lines.append(f'TABLE id={s.id} name="{s.name}" file="{s.filename}" rows={s.row_count}')
            if s.description:
                lines.append(f"  about: {s.description}")
            for c in s.columns:
                extra = ""
                if c.role in ("measure", "geo_lat", "geo_lon") or c.dtype in ("date", "datetime"):
                    extra = f" range={_fmt(c.min)}..{_fmt(c.max)}" + (f" mean={c.mean}" if c.mean is not None else "")
                elif c.top_values:
                    extra = f" values={_fmt(c.top_values[:8])} distinct={c.distinct_count}"
                desc = f" - {c.description}" if c.description else ""
                lines.append(f"  - {c.name} [{c.dtype}/{c.role}]{extra}{desc}")
        else:
            lines.append(f'DOCUMENT id={s.id} name="{s.name}" file="{s.filename}" chunks={s.chunk_count}')
            if s.description:
                lines.append(f"  about: {s.description}")
            if s.topics:
                lines.append(f"  topics: {', '.join(s.topics)}")
    rel_lines = [
        f'{by_id[r.from_source].name}.{r.from_column} <-> {by_id[r.to_source].name}.{r.to_column}'
        for r in rels
        if r.from_source in by_id and r.to_source in by_id
    ]
    if rel_lines:
        lines.append("RELATIONSHIPS (filters propagate across these): " + "; ".join(rel_lines))
    return "\n".join(lines)


def render_dashboard(req: ChatRequest) -> str:
    if not req.dashboard or not req.dashboard.widgets:
        return "(dashboard is empty)"
    out = [f'Dashboard "{req.dashboard.title}":']
    for w in req.dashboard.widgets:
        q = w.query
        detail = ""
        if q:
            dims = [d.alias or d.column for d in q.dimensions]
            meas = [f"{m.agg}({m.column or '*'}) as {m.alias}" for m in q.measures]
            detail = f" table={q.source_id} dims={dims} measures={meas} filters={_fmt([f.model_dump() for f in q.filters])}"
        elif w.slicer_column:
            detail = f" table={w.source_id} column={w.slicer_column}"
        out.append(f'- id={w.id} type={w.type} title="{w.title}"{detail}')
    if req.filters:
        out.append("Active user filters: " + _fmt([f.model_dump(exclude={"origin_widget_id"}) for f in req.filters]))
    return "\n".join(out)


def render_history(history: list[dict[str, Any]], limit: int = 8) -> str:
    if not history:
        return "(none)"
    return "\n".join(f"{m['role']}: {m['content'][:600]}" for m in history[-limit:])


def render_result(title: str, res: QueryResult, max_rows: int = 25) -> str:
    cols = ", ".join(f"{c.name}" for c in res.columns)
    rows = [list(r.values()) for r in res.rows[:max_rows]]
    more = (
        f" (preview of the first {max_rows} of {res.total_rows} rows: the dashboard widget shows all {res.total_rows})"
        if res.total_rows > max_rows
        else ""
    )
    return f"## {title}{more}\ncolumns: {cols}\nrows: {_fmt(rows)}"


def domain() -> str:
    d = get_settings().domain_context
    return f"\nProject context: {d}\n" if d else ""


ROUTER_SYSTEM = """You are the orchestrator of a Power BI-style analytics copilot. Read the user's latest
message and decide how to serve it. {domain}
Intents:
- dashboard: user wants visuals/KPIs/charts/an overview built from tabular data (build or rebuild a dashboard).
- modify_dashboard: user wants to change the existing dashboard (add/remove/alter a widget, change chart type, filter).
- data_analysis: a question answerable by querying tables (rankings, comparisons, trends, "which/what/how many") where a written analysis is the main output. Still set needs_kpis=true if a visual would help the user see it.
- document_qa: a question answerable from uploaded research documents (papers, reports).
- hybrid: needs both table results and document passages (e.g. interpret numbers with the literature).
- general: greetings, help with the tool, or questions needing no uploaded data.

Decide:
- needs_data_queries: tables must be queried.
- needs_kpis: widgets should be (re)drawn on the dashboard. False for pure Q&A or prose-only analysis.
- needs_documents: document passages must be retrieved.
- source_ids: ids of the tables/documents relevant to the request (from the catalog). Empty = all.
- dashboard_action: replace (new dashboard theme/topic), append (add to the current one), remove (delete widgets), none.
- remove_widget_ids: ids from the current dashboard when removing.
- doc_query: a self-contained search query for document retrieval (resolve pronouns using history).
- clarification: only if the request is impossible to act on even with sensible assumptions; otherwise null.
Prefer acting with reasonable assumptions over asking."""

PLANNER_SYSTEM = """You are the query + visual planner of a Power BI-style copilot dashboard. {domain}
Turn the request into widget specs that will be executed against the tables in the catalog.

QUERY RULES
- Use table ids and column names EXACTLY as written in the catalog. Never invent columns.
- Aggregated mode: query.dimensions (group-by columns; date columns may use bucket day|week|month|quarter|year) + query.measures
  (agg sum|avg|min|max|count|count_distinct|median; sum/avg/median only on numeric columns; column=null with agg=count counts rows).
  Every measure needs a short snake_case alias.
- Raw mode (no dimensions/measures): query.select lists columns - use for tables and scatter/bubble/map plots.
- Filters: {{column, op, value}} with op eq|neq|in|not_in|gt|gte|lt|lte|between|contains; use values that exist in the catalog.
- Sort explicitly and cap categories with limit (<=15 for bar/pie/funnel, <=10 for treemap/radar, <=500 for tables).
- encoding refers to OUTPUT column names: a dimension's alias (or column name) and measure aliases.
- For bar/column/line/area charts, encoding.x is ALWAYS the category or time field and encoding.y the measure(s), even for horizontal bar/stacked_bar (the renderer rotates them).

VISUAL CHOICE
card: one KPI (no dimensions). gauge: KPI against a known max (options.max). line/area: trend over time (date bucket as x).
bar: ranking or comparison, horizontal-friendly with long labels; column: few categories or ordered buckets; stacked_bar/stacked_column:
composition across categories (2 dimensions, series = second). pie/donut: share of a whole, <=6 slices. treemap: hierarchical share.
funnel: ordered stages. scatter/bubble: relationship between 2-3 numeric columns (raw mode; series/label optional). heatmap: 2 dimensions x 1 measure.
matrix: pivot with rows x columns x value. radar: compare a few entities across several measures. table: record detail.
map: anything geographic. Catalog roles geo_state / geo_country / geo_city mark columns of place NAMES (whatever they are called):
  (a) geo_state or geo_country -> a FILLED map: aggregated mode, dimensions=[that column], measures=[the metric],
      encoding.location=that column, encoding.value=the metric. No coordinates are needed.
  (b) geo_city -> bubbles: same, and also add the state/country column (geo_state/geo_country) as a second dimension with
      encoding.region set to it, so ambiguous city names resolve correctly. Limit <=300 cities (top by the metric).
  (c) geo_lat + geo_lon columns -> points: raw mode (or aggregated by both), encoding.lat/lon/size/label.
  NEVER say a map is impossible or unsupported when the table has any geo_* column, and never ask for coordinates: build it. slicer: interactive filter on a dimension/date/range column (set source_id + slicer_column, no query).

EXPLICIT REQUESTS WIN: if the user names a visual ("pie chart of sales by category", "map", "scatter plot", "heatmap"),
emit exactly that widget type for that data. Never substitute a table or card for a requested chart.

DESIGNING A NEW DASHBOARD (think Power BI report page, not a data dump):
- 3-4 KPI cards first. Give each card a `trend`: the same measure and filters grouped by ONE date dimension with a bucket
  (month for ranges up to ~3 years, otherwise year), sorted ascending, no limit. Skip `trend` when the table has no date column.
- 1-2 slicers at most, on the most useful dimension/date. Slicers need source_id + slicer_column, no query.
- Then 3-5 charts of DIFFERENT kinds that answer different questions: a time trend (line/area, span=full or two_thirds),
  a ranking (bar), a composition (donut or treemap), a relationship (scatter) and/or a geographic view (map) when the data supports it.
  Do not repeat the same chart type with the same dimension.
- A table only when the user asks for records/detail. Keep it to <=10 columns, limit <=100 rows.
- At most 9 widgets in total. Titles say what is shown ("Sales by category"), not how ("Bar chart").
- Time trends: query.dimensions=[date with bucket], sort ascending by that dimension, and NEVER a limit (every period must appear).
Cross-filtering: every chart is clickable and filters others automatically - do not add filter plumbing.
Chart title = what it shows. options: format (number|compact|percent|currency|duration), unit, decimals, max.
Use format=percent only when the values are already percentage points (e.g. 20.9 means 20.9%); put units like "mm/s" or "K" in options.unit.

OTHER RULES
- If an existing widget should change (type, measure, filter), emit a replacement with `replaces` = that widget's id.
- If appending, do not duplicate widgets already on the dashboard.
- analysis_queries: extra hidden queries (rankings, extremes, comparisons) whose results you need to write the answer; keep to <=4.
- If the tables cannot answer the request return no widgets and no queries.
- Return widgets=[] when the user only wants prose and a table/chart would add nothing."""

SYNTH_SYSTEM = """You are the analyst voice of a Power BI-style copilot embedded next to a dashboard. {domain}
Write the reply to the user in concise Markdown.
- Result previews may be cut short for brevity; widgets always show the full result. Never describe a chart or map as partial
  or incomplete because of a preview.
- Ground every number in the QUERY RESULTS provided; never invent figures. Quote values with units/rounding sensibly.
- When document excerpts are provided, use them and cite as [1], [2] matching the excerpt numbers. Do not cite what you did not use.
- If the user asked to rank or compare, give an explicit ranked list with the metric.
- Interpret: say what the numbers mean for the project goal, not just what they are. Flag caveats (small samples, missing data, active filters).
- If widgets were added to the dashboard, mention briefly what they show; don't re-list every value.
- If some requested widgets could not be built, say so plainly and why.
- If there is no uploaded data and the question needs it, tell the user to upload a file in the Data tab.
- key_insights: 2-4 one-line takeaways for a dashboard insight card (empty if nothing substantive).
- suggestions: 3 short follow-up questions the user might ask next."""
