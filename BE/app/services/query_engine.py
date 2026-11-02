from __future__ import annotations

from typing import Any

import pandas as pd

from app.db.store import Store
from app.schemas import (
    ActiveFilter,
    ColumnSchema,
    Filter,
    QueryResult,
    QuerySpec,
    Relationship,
    ResultColumn,
    SourceDoc,
)
from app.services.filters import QueryError, coerce_filters
from app.services.schema_infer import _scalar
from app.services.semantic import resolve_slicers

MAX_FETCH = 200_000
DEFAULT_GROUP_LIMIT = 500
DEFAULT_RAW_LIMIT = 1_000
HARD_LIMIT = 5_000

_AGG_FUNC = {"sum": "sum", "avg": "mean", "min": "min", "max": "max", "count": "count",
             "count_distinct": "nunique", "median": "median"}


def _bucket_label(s: pd.Series, bucket: str) -> pd.Series:
    dt = pd.to_datetime(s, errors="coerce")
    if bucket == "day":
        out = dt.dt.strftime("%Y-%m-%d")
    elif bucket == "week":
        out = (dt - pd.to_timedelta(dt.dt.weekday, unit="D")).dt.strftime("%Y-%m-%d")
    elif bucket == "month":
        out = dt.dt.strftime("%Y-%m")
    elif bucket == "quarter":
        out = dt.dt.year.astype("Int64").astype(str) + "-Q" + dt.dt.quarter.astype("Int64").astype(str)
        out = out.where(dt.notna())
    else:
        out = dt.dt.strftime("%Y")
    return out


def _clean(df: pd.DataFrame) -> list[dict[str, Any]]:
    cols = list(df.columns)
    return [
        {c: (round(v, 6) if isinstance(v := _scalar(x), float) else v) for c, x in zip(cols, row)}
        for row in df.itertuples(index=False, name=None)
    ]


async def run_query(
    store: Store,
    source: SourceDoc,
    spec: QuerySpec,
    slicers: list[ActiveFilter] | None = None,
    relationships: list[Relationship] | None = None,
    exclude_origin: str | None = None,
) -> QueryResult:
    if source.kind != "tabular":
        raise QueryError(f"Source {source.filename!r} is not a table")
    if source.status != "ready":
        raise QueryError(f"Source {source.filename!r} is still {source.status}")
    cols: dict[str, ColumnSchema] = {c.name: c for c in source.columns}

    def need(name: str, what: str) -> ColumnSchema:
        if name not in cols:
            raise QueryError(
                f"Unknown {what} column {name!r} in {source.filename!r}. Available: {', '.join(cols)}"
            )
        return cols[name]

    for d in spec.dimensions:
        need(d.column, "dimension")
    for c in spec.select:
        need(c, "select")

    extra: list[Filter] = [
        f for f in resolve_slicers(source.id, slicers or [], relationships or [], exclude_origin) if f.column in cols
    ]
    filters = coerce_filters(list(spec.filters) + extra, cols)
    rows = await store.fetch_rows(source.id, filters, limit=MAX_FETCH)
    df = pd.DataFrame.from_records(rows, columns=list(cols)) if rows else pd.DataFrame(columns=list(cols))

    aggregated = bool(spec.dimensions or spec.measures)
    if aggregated:
        out, result_cols = _aggregate(df, spec, cols)
    else:
        select = spec.select or list(cols)
        out = df[select].copy()
        result_cols = [ResultColumn(name=c, dtype=cols[c].dtype) for c in select]

    names = [c.name for c in result_cols]
    for s in spec.sort:
        if s.by not in names:
            raise QueryError(f"Cannot sort by {s.by!r}; output columns are {names}")
    if spec.sort:
        out = out.sort_values(
            by=[s.by for s in spec.sort],
            ascending=[s.dir == "asc" for s in spec.sort],
            kind="stable",
            na_position="last",
        )
    elif aggregated:
        out = _default_sort(out, spec, cols)

    default_limit = DEFAULT_GROUP_LIMIT if aggregated else DEFAULT_RAW_LIMIT
    limit = min(spec.limit or default_limit, HARD_LIMIT)
    total = len(out)
    return QueryResult(
        columns=result_cols,
        rows=_clean(out.head(limit)),
        total_rows=total,
        truncated=total > limit,
    )


def _aggregate(df: pd.DataFrame, spec: QuerySpec, cols: dict[str, ColumnSchema]):
    work = pd.DataFrame(index=df.index)
    keys: list[str] = []
    result_cols: list[ResultColumn] = []
    used: set[str] = set()

    for i, d in enumerate(spec.dimensions):
        name = d.alias or d.column
        if name in used:
            raise QueryError(f"Duplicate output column name {name!r}")
        used.add(name)
        series = df[d.column]
        if d.bucket:
            if cols[d.column].dtype not in ("date", "datetime"):
                raise QueryError(f"Cannot bucket non-date column {d.column!r}")
            series = _bucket_label(series, d.bucket)
        work[f"__d{i}"] = series.astype(object).where(series.notna(), None)
        keys.append(f"__d{i}")
        result_cols.append(
            ResultColumn(name=name, dtype="string" if d.bucket else cols[d.column].dtype)
        )
    renames = {k: (d.alias or d.column) for k, d in zip(keys, spec.dimensions)}

    named: dict[str, tuple[str, str]] = {}
    for i, m in enumerate(spec.measures):
        if m.alias in used:
            raise QueryError(f"Duplicate output column name {m.alias!r}")
        used.add(m.alias)
        if m.column is None:
            if m.agg not in ("count", "sum"):
                raise QueryError(f"Measure {m.alias!r} needs a column for {m.agg}")
            work[f"__m{i}"] = 1
            func, dtype = "sum", "integer"
        else:
            col = cols.get(m.column)
            if col is None:
                raise QueryError(f"Unknown measure column {m.column!r}. Available: {', '.join(cols)}")
            numeric = col.dtype in ("integer", "float")
            if m.agg in ("sum", "avg", "median") and not numeric:
                raise QueryError(f"Cannot {m.agg} non-numeric column {m.column!r} ({col.dtype})")
            series = pd.to_numeric(df[m.column], errors="coerce") if numeric else df[m.column]
            work[f"__m{i}"] = series
            func = _AGG_FUNC[m.agg]
            if m.agg in ("count", "count_distinct"):
                dtype = "integer"
            elif m.agg in ("min", "max"):
                dtype = col.dtype
            else:
                dtype = "float"
        named[m.alias] = (f"__m{i}", func)
        result_cols.append(ResultColumn(name=m.alias, dtype=dtype))

    if keys:
        if named:
            grouped = work.groupby(keys, dropna=False, sort=False).agg(
                **{alias: pd.NamedAgg(column=c, aggfunc=f) for alias, (c, f) in named.items()}
            ).reset_index()
        else:
            grouped = work[keys].drop_duplicates().reset_index(drop=True)
    else:
        grouped = pd.DataFrame(
            [{alias: getattr(work[c], f)() if len(work) else (0 if f in ("sum", "count", "nunique") else None)
              for alias, (c, f) in named.items()}]
        )
    return grouped.rename(columns=renames), result_cols


def _default_sort(out: pd.DataFrame, spec: QuerySpec, cols: dict[str, ColumnSchema]) -> pd.DataFrame:
    if out.empty or not spec.dimensions:
        return out
    first = spec.dimensions[0]
    first_name = first.alias or first.column
    if first.bucket or cols[first.column].dtype in ("date", "datetime"):
        return out.sort_values([d.alias or d.column for d in spec.dimensions], kind="stable", na_position="last")
    if spec.measures:
        return out.sort_values(spec.measures[0].alias, ascending=False, kind="stable", na_position="last")
    return out.sort_values(first_name, kind="stable", na_position="last")
