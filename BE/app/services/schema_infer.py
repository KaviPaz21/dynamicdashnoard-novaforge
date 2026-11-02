from __future__ import annotations

import math
import re
from datetime import date, datetime
from typing import Any

import numpy as np
import pandas as pd

from app.schemas import ColumnSchema
from app.services.geo import ROLE_FOR_KIND, detect_kind

DATE_LIKE = re.compile(r"^\s*(\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{2,4}|\d{4}[-/]\d{1,2})([ T].*)?$")
LAT_NAME = re.compile(r"(^|[^a-z])(lat|latitude)($|[^a-z])", re.I)
LON_NAME = re.compile(r"(^|[^a-z])(lon|lng|long|longitude)($|[^a-z])", re.I)
POINT = re.compile(r"^\s*[(\[]?\s*(-?\d{1,3}(?:\.\d+)?)\s*[,;/ ]\s*(-?\d{1,3}(?:\.\d+)?)\s*[)\]]?\s*$")
ID_NAME = re.compile(r"(^|[_\s-])(id|uuid|guid|key|code|no|number)$", re.I)
CODE_NAME = re.compile(r"(zip|postal|phone|fips|(^|[_\s-])code)", re.I)
CATEGORICAL_INT_NAME =re.compile(r"(year|month|day|week|quarter|rank|class|grade|level|zone|group|flag)", re.I)
BOOL_TRUE = {"true", "yes", "y", "t"}
BOOL_FALSE = {"false", "no", "n", "f"}
NUM_CLEAN = re.compile("[,\\s$€£%]")


def _texty(s: pd.Series) -> bool:
    return s.dtype == object or pd.api.types.is_string_dtype(s)


def _try_numeric(s: pd.Series) -> pd.Series | None:
    if pd.api.types.is_numeric_dtype(s):
        return s
    if s.dropna().astype(str).str.match(r"^\s*0\d+\s*$").mean() > 0.01:
        return None
    cleaned = s.astype(str).str.replace(NUM_CLEAN, "", regex=True)
    cleaned = cleaned.str.replace(r"^\((.*)\)$", r"-\1", regex=True)
    conv = pd.to_numeric(cleaned, errors="coerce").where(s.notna())
    if s.notna().sum() and conv.notna().sum() / s.notna().sum() >= 0.95:
        return conv
    return None


def _naive(parsed: pd.Series) -> pd.Series | None:
    if not pd.api.types.is_datetime64_any_dtype(parsed):
        return None
    return parsed.dt.tz_localize(None) if parsed.dt.tz is not None else parsed


def _try_datetime(s: pd.Series) -> pd.Series | None:
    if pd.api.types.is_datetime64_any_dtype(s):
        return _naive(s)
    sample = s.dropna().astype(str).head(200)
    if sample.empty:
        return None
    if isinstance(s.dropna().iloc[0], (datetime, date, pd.Timestamp)):
        return _naive(pd.to_datetime(s, errors="coerce"))
    if sample.str.match(DATE_LIKE).mean() < 0.9:
        return None
    parsed = pd.to_datetime(s, errors="coerce", format="mixed", utc=True)
    if s.notna().sum() and parsed.notna().sum() / s.notna().sum() >= 0.9:
        return _naive(parsed)
    return None


def _try_boolean(s: pd.Series) -> pd.Series | None:
    if pd.api.types.is_bool_dtype(s):
        return s
    vals = s.dropna().astype(str).str.strip().str.lower()
    if vals.empty or vals.nunique() > 2:
        return None
    if set(vals.unique()) <= BOOL_TRUE | BOOL_FALSE:
        mapped = s.astype(str).str.strip().str.lower().map(lambda v: True if v in BOOL_TRUE else False if v in BOOL_FALSE else None)
        return mapped.where(s.notna())
    return None


def _scalar(v: Any) -> Any:
    if v is None:
        return None
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (np.floating, float)):
        f = float(v)
        return None if math.isnan(f) or math.isinf(f) else (int(f) if f.is_integer() and abs(f) < 1e15 else f)
    if isinstance(v, (np.bool_,)):
        return bool(v)
    if isinstance(v, pd.Timestamp):
        if pd.isna(v):
            return None
        return v.isoformat() if (v.hour or v.minute or v.second or v.microsecond) else v.date().isoformat()
    if isinstance(v, datetime):
        return v.isoformat()
    if isinstance(v, date):
        return v.isoformat()
    if v is pd.NaT:
        return None
    return v


def infer_table(df: pd.DataFrame) -> tuple[pd.DataFrame, list[ColumnSchema]]:
    typed = pd.DataFrame(index=df.index)
    schemas: list[ColumnSchema] = []
    n = len(df)

    for name in df.columns:
        raw = df[name]
        if _texty(raw):
            raw = raw.astype(object).map(lambda v: v.strip() if isinstance(v, str) else v).replace({"": None})
            raw = raw.where(raw.notna(), None)
        dtype, role = "string", "dimension"

        s_bool = _try_boolean(raw) if _texty(raw) or pd.api.types.is_bool_dtype(raw) else None
        s_date = None if s_bool is not None else _try_datetime(raw) if _texty(raw) or pd.api.types.is_datetime64_any_dtype(raw) else None
        s_num = None if (s_bool is not None or s_date is not None) else _try_numeric(raw)

        if s_bool is not None:
            col, dtype = s_bool.astype(object).where(s_bool.notna(), None), "boolean"
        elif s_date is not None:
            has_time = bool(
                ((s_date.dt.hour != 0) | (s_date.dt.minute != 0) | (s_date.dt.second != 0)).any()
            )
            col, dtype, role = s_date, "datetime" if has_time else "date", "date"
        elif s_num is not None:
            non_null = s_num.dropna()
            is_int = bool(len(non_null)) and bool((non_null % 1 == 0).all())
            col, dtype = s_num, "integer" if is_int else "float"
            role = "measure"
        else:
            col = raw.astype(object).where(raw.notna(), None)
            col = col.map(lambda v: v if v is None else str(v))

        non_null = col.dropna()
        distinct = int(non_null.nunique())
        ratio = distinct / max(len(non_null), 1)

        if dtype in ("integer", "float"):
            lo, hi = non_null.min() if len(non_null) else None, non_null.max() if len(non_null) else None
            if LAT_NAME.search(name) and lo is not None and -90 <= lo and hi <= 90:
                role = "geo_lat"
            elif LON_NAME.search(name) and lo is not None and -180 <= lo and hi <= 180:
                role = "geo_lon"
            elif dtype == "integer":
                if ID_NAME.search(name) and ratio > 0.9 and n > 20:
                    role = "id"
                elif CODE_NAME.search(name):
                    role = "dimension"
                elif CATEGORICAL_INT_NAME.search(name) or (distinct <= 12 and ratio < 0.05 and n > 50):
                    role = "dimension"
        elif dtype == "string":
            avg_len = non_null.str.len().mean() if len(non_null) else 0
            if ratio > 0.5 and avg_len > 60:
                role = "text"
            elif ID_NAME.search(name) and ratio > 0.9 and n > 20:
                role = "id"
            elif distinct <= 20000:
                kind = detect_kind(name, non_null.unique()[:2000])
                if kind:
                    role = ROLE_FOR_KIND[kind]

        typed[name] = col

        info = ColumnSchema(
            name=name,
            dtype=dtype,
            role=role,
            null_count=int(col.isna().sum()),
            distinct_count=distinct,
        )
        if dtype in ("integer", "float"):
            info.min, info.max = _scalar(non_null.min()), _scalar(non_null.max())
            info.mean = round(float(non_null.mean()), 4) if len(non_null) else None
        elif dtype in ("date", "datetime"):
            info.min, info.max = _scalar(non_null.min()), _scalar(non_null.max())
        if role in ("dimension", "id", "text", "geo_country", "geo_state", "geo_city") or dtype == "boolean":
            top = non_null.value_counts().head(8).index.tolist()
            info.top_values = [_scalar(v) if role != "text" else str(v)[:80] for v in top]
        else:
            info.top_values = [_scalar(v) for v in non_null.head(3).tolist()]
        schemas.append(info)

    _split_points(typed, schemas)
    return typed, schemas


def _split_points(typed: pd.DataFrame, schemas: list[ColumnSchema]) -> None:
    for info in list(schemas):
        if info.dtype != "string" or info.role not in ("dimension", "id"):
            continue
        s = typed[info.name]
        m = s.dropna().astype(str).str.extract(POINT)
        if len(m) == 0 or m[0].notna().mean() < 0.9:
            continue
        a = pd.to_numeric(s.astype(str).str.extract(POINT)[0], errors="coerce")
        b = pd.to_numeric(s.astype(str).str.extract(POINT)[1], errors="coerce")
        if a.abs().max() > 90 and b.abs().max() <= 90:
            a, b = b, a
        if a.abs().max() > 90 or b.abs().max() > 180:
            continue
        for suffix, series, role in (("lat", a, "geo_lat"), ("lon", b, "geo_lon")):
            name = f"{info.name} ({suffix})"
            typed[name] = series
            nn = series.dropna()
            schemas.append(
                ColumnSchema(
                    name=name, dtype="float", role=role, null_count=int(series.isna().sum()),
                    distinct_count=int(nn.nunique()), min=_scalar(nn.min()), max=_scalar(nn.max()),
                    mean=round(float(nn.mean()), 4) if len(nn) else None,
                    top_values=[_scalar(v) for v in nn.head(3).tolist()],
                    description=f"{'Latitude' if suffix == 'lat' else 'Longitude'} parsed from '{info.name}'",
                )
            )
        info.role = "text"


def to_records(df: pd.DataFrame) -> list[dict[str, Any]]:
    cols = list(df.columns)
    return [{c: _scalar(v) for c, v in zip(cols, row)} for row in df.itertuples(index=False, name=None)]

