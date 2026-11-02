from __future__ import annotations

from typing import Any

from app.schemas import ColumnSchema, Filter


class QueryError(ValueError):
    pass


def _to_float(v: Any) -> float:
    try:
        return float(v)
    except (TypeError, ValueError) as e:
        raise QueryError(f"Expected a number, got {v!r}") from e


def _to_bool(v: Any) -> bool:
    if isinstance(v, bool):
        return v
    s = str(v).strip().lower()
    if s in {"true", "1", "yes", "y"}:
        return True
    if s in {"false", "0", "no", "n"}:
        return False
    raise QueryError(f"Expected a boolean, got {v!r}")


def coerce_filters(filters: list[Filter], columns: dict[str, ColumnSchema]) -> list[Filter]:
    out: list[Filter] = []
    for f in filters:
        col = columns.get(f.column)
        if col is None:
            raise QueryError(f"Unknown column in filter: {f.column!r}")

        def conv(v: Any, *, upper: bool = False) -> Any:
            if v is None:
                return None
            if col.dtype in ("integer", "float"):
                return _to_float(v)
            if col.dtype == "boolean":
                return _to_bool(v)
            if col.dtype == "datetime" and isinstance(v, str) and len(v) == 10 and upper:
                return v + "T23:59:59.999999"
            return v if col.dtype == "string" else str(v)

        if f.op in ("in", "not_in"):
            vals = f.value if isinstance(f.value, list) else [f.value]
            out.append(Filter(column=f.column, op=f.op, value=[conv(v) for v in vals]))
        elif f.op == "between":
            if not isinstance(f.value, list) or len(f.value) != 2:
                raise QueryError("'between' needs [low, high]")
            out.append(
                Filter(column=f.column, op="between", value=[conv(f.value[0]), conv(f.value[1], upper=True)])
            )
        elif f.op == "contains":
            out.append(Filter(column=f.column, op="contains", value=str(f.value or "").lower()))
        else:
            out.append(Filter(column=f.column, op=f.op, value=conv(f.value, upper=f.op in ("lte",))))
    return out


def row_matches(data: dict[str, Any], filters: list[Filter]) -> bool:
    for f in filters:
        v = data.get(f.column)
        op = f.op
        try:
            if op == "eq":
                ok = v == f.value
            elif op == "neq":
                ok = v != f.value
            elif op == "in":
                ok = v in f.value
            elif op == "not_in":
                ok = v not in f.value
            elif op == "contains":
                ok = isinstance(v, str) and f.value in v.lower()
            elif v is None:
                ok = False
            elif op == "gt":
                ok = v > f.value
            elif op == "gte":
                ok = v >= f.value
            elif op == "lt":
                ok = v < f.value
            elif op == "lte":
                ok = v <= f.value
            elif op == "between":
                ok = f.value[0] <= v <= f.value[1]
            else:
                ok = True
        except TypeError:
            ok = False
        if not ok:
            return False
    return True
