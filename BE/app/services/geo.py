from __future__ import annotations

import re
import unicodedata
from functools import lru_cache
from typing import Any, Iterable

from app.schemas import SourceDoc

GEO_VERSION = 1

ROLE_FOR_KIND = {"us_state": "geo_state", "country": "geo_country", "city": "geo_city"}
KIND_FOR_ROLE = {v: k for k, v in ROLE_FOR_KIND.items()}

_COUNTRY_ALIASES = {
    "usa": "US", "us": "US", "u.s.": "US", "u.s.a.": "US", "united states of america": "US", "america": "US",
    "uk": "GB", "u.k.": "GB", "great britain": "GB", "britain": "GB", "england": "GB",
    "russian federation": "RU", "south korea": "KR", "republic of korea": "KR", "korea": "KR", "korea republic of": "KR",
    "north korea": "KP", "viet nam": "VN", "czech republic": "CZ", "ivory coast": "CI", "cote d'ivoire": "CI",
    "uae": "AE", "burma": "MM", "holland": "NL", "the netherlands": "NL", "turkiye": "TR", "swaziland": "SZ",
    "macedonia": "MK", "cape verde": "CV", "east timor": "TL", "laos": "LA", "syria": "SY", "iran": "IR",
    "bolivia": "BO", "venezuela": "VE", "tanzania": "TZ", "moldova": "MD", "brunei": "BN", "palestine": "PS",
    "hong kong sar": "HK", "peoples republic of china": "CN", "prc": "CN", "democratic republic of the congo": "CD",
    "dr congo": "CD", "drc": "CD", "republic of the congo": "CG",
}
_STATE_HINT = re.compile(r"(state|province|prov|region|county|territory)", re.I)
_COUNTRY_HINT = re.compile(r"(country|nation|ctry|iso|nationality)", re.I)
_CITY_HINT = re.compile(r"(city|town|municipal|locality|place|location|site|metro|village)", re.I)


def norm(s: Any) -> str:
    text = unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode().casefold()
    text = re.sub(r"[^\w\s']", " ", text).replace("'", "")
    return re.sub(r"\s+", " ", text).strip()


@lru_cache(maxsize=1)
def _gc():
    import geonamescache

    return geonamescache.GeonamesCache()


@lru_cache(maxsize=1)
def _states() -> dict[str, dict]:
    out: dict[str, dict] = {}
    for st in _gc().get_us_states().values():
        rec = {"id": st["fips"], "code": st["code"], "label": st["name"]}
        out[norm(st["name"])] = rec
        out[norm(st["code"])] = rec
    out["washington dc"] = out["dc"] = out["district of columbia"]
    return out


@lru_cache(maxsize=1)
def _countries() -> dict[str, dict]:
    out: dict[str, dict] = {}
    by_iso: dict[str, dict] = {}
    for c in _gc().get_countries().values():
        rec = {"id": f"{c['isonumeric']:03d}", "iso": c["iso"], "label": c["name"]}
        by_iso[c["iso"]] = rec
        for key in (c["name"], c["iso"], c["iso3"]):
            out.setdefault(norm(key), rec)
    for alias, iso in _COUNTRY_ALIASES.items():
        if iso in by_iso:
            out.setdefault(norm(alias), by_iso[iso])
    return out


@lru_cache(maxsize=1)
def _cities() -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = {}
    for c in _gc().get_cities().values():
        rec = {
            "lat": c["latitude"], "lon": c["longitude"], "label": c["name"], "country": c["countrycode"],
            "admin1": c["admin1code"], "pop": c["population"],
        }
        names = {c["name"], *[a for a in c.get("alternatenames", []) if a.isascii() and len(a) > 2]}
        for n in names:
            out.setdefault(norm(n), []).append(rec)
    for lst in out.values():
        lst.sort(key=lambda r: -r["pop"])
    return out


def _lookup(kind: str) -> dict:
    return {"us_state": _states, "country": _countries}[kind]()


def detect_kind(name: str, values: Iterable[Any]) -> str | None:
    vals = [norm(v) for v in values if v is not None and str(v).strip()]
    if not vals:
        return None
    vals = list(dict.fromkeys(vals))[:400]
    n = len(vals)
    states, countries = _states(), _countries()
    s_ratio = sum(v in states for v in vals) / n
    c_ratio = sum(v in countries for v in vals) / n
    short = sum(len(v) <= 3 for v in vals) / n > 0.6

    if s_ratio >= 0.85 and (not short or _STATE_HINT.search(name)) and (s_ratio >= c_ratio or _STATE_HINT.search(name)):
        return "us_state"
    if c_ratio >= 0.85 and (not short or _COUNTRY_HINT.search(name)):
        return "country"
    cities = _cities()
    ci_ratio = sum(v in cities for v in vals) / n
    if (ci_ratio >= 0.8 and _CITY_HINT.search(name)) or (ci_ratio >= 0.92 and n >= 5 and not short):
        return "city"
    return None


def resolve(kind: str, items: list[dict[str, Any]]) -> list[dict[str, Any] | None]:
    out: list[dict[str, Any] | None] = []
    if kind in ("us_state", "country"):
        table = _lookup(kind)
        for it in items:
            rec = table.get(norm(it["name"]))
            out.append({k: v for k, v in rec.items() if k != "code"} if rec else None)
        return out

    cities, states, countries = _cities(), _states(), _countries()
    for it in items:
        cands = cities.get(norm(it["name"]), [])
        hint = norm(it["hint"]) if it.get("hint") else ""
        if cands and hint:
            st = states.get(hint)
            co = countries.get(hint)
            narrowed = [
                c for c in cands
                if (st and c["country"] == "US" and c["admin1"] == st["code"]) or (co and c["country"] == co["iso"])
            ]
            cands = narrowed or cands
        out.append({"lat": cands[0]["lat"], "lon": cands[0]["lon"], "label": cands[0]["label"]} if cands else None)
    return out


async def ensure_geo(store, source: SourceDoc) -> bool:
    if source.kind != "tabular" or source.status != "ready" or source.geo_version >= GEO_VERSION:
        return False
    rows = await store.fetch_rows(source.id, [], limit=20000)
    changed = False
    for col in source.columns:
        if col.dtype == "string" and col.role == "dimension":
            kind = detect_kind(col.name, (r.get(col.name) for r in rows))
            if kind:
                col.role = ROLE_FOR_KIND[kind]
                changed = True
    source.geo_version = GEO_VERSION
    await store.upsert("sources", source.model_dump())
    return changed
