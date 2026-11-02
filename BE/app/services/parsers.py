from __future__ import annotations

import codecs
import csv
import io
import json
from pathlib import PurePath

import pandas as pd

TABULAR_EXT = {".csv", ".tsv", ".xlsx", ".xlsm", ".xls", ".json", ".jsonl"}
TEXT_EXT = {".pdf", ".txt", ".md", ".markdown", ".docx", ".rst"}


class UnsupportedFile(ValueError):
    pass


def detect_kind(filename: str) -> str:
    ext = PurePath(filename).suffix.lower()
    if ext in TABULAR_EXT:
        return "tabular"
    if ext in TEXT_EXT:
        return "text"
    raise UnsupportedFile(
        f"Unsupported file type {ext or '(none)'}. Supported: "
        + ", ".join(sorted(TABULAR_EXT | TEXT_EXT))
    )


def _decode(data: bytes) -> str:
    if data.startswith(codecs.BOM_UTF8):
        return data.decode("utf-8-sig")
    if data.startswith((codecs.BOM_UTF32_LE, codecs.BOM_UTF32_BE)):
        return data.decode("utf-32")
    if data.startswith((codecs.BOM_UTF16_LE, codecs.BOM_UTF16_BE)):
        return data.decode("utf-16")
    head = data[:4096]
    if head.count(b"\x00") > len(head) // 4:
        enc = "utf-16-le" if head[1::2].count(b"\x00") > head[0::2].count(b"\x00") else "utf-16-be"
        try:
            return data.decode(enc)
        except UnicodeError:
            pass
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        return data.decode("cp1252", errors="replace")


def _delimiter(text: str, ext: str) -> str:
    lines = [ln for ln in text.splitlines()[:60] if ln.strip()]
    candidates = ["\t", ",", ";", "|"] if ext == ".tsv" else [",", ";", "\t", "|"]
    best, best_key = candidates[0], (-1.0, -1)
    for d in candidates:
        try:
            counts = [len(row) for row in csv.reader(lines, delimiter=d)]
        except csv.Error:
            continue
        if not counts:
            continue
        mode = max(set(counts), key=counts.count)
        if mode < 2:
            continue
        key = (counts.count(mode) / len(counts), mode)
        if key > best_key:
            best, best_key = d, key
    return best


def _read_csv(text: str, delim: str) -> pd.DataFrame:
    kwargs = dict(sep=delim, dtype=str, keep_default_na=True, skipinitialspace=True)
    try:
        return pd.read_csv(io.StringIO(text), on_bad_lines="skip", **kwargs)
    except (pd.errors.ParserError, ValueError):
        return pd.read_csv(io.StringIO(text), engine="python", on_bad_lines="skip", quoting=csv.QUOTE_NONE, **kwargs)


def _tidy(df: pd.DataFrame) -> pd.DataFrame:
    df = df.dropna(how="all").dropna(axis=1, how="all")
    cols: list[str] = []
    seen: dict[str, int] = {}
    for i, c in enumerate(df.columns):
        name = str(c).strip() or f"column_{i + 1}"
        if name in seen:
            seen[name] += 1
            name = f"{name}_{seen[name]}"
        else:
            seen[name] = 0
        cols.append(name)
    df = df.copy()
    df.columns = cols
    return df.reset_index(drop=True)


def read_tables(filename: str, data: bytes) -> list[tuple[str, pd.DataFrame]]:
    ext = PurePath(filename).suffix.lower()
    stem = PurePath(filename).stem
    if ext in (".csv", ".tsv"):
        text = _decode(data)
        frames = [(stem, _read_csv(text, _delimiter(text, ext)))]
    elif ext in (".xlsx", ".xlsm", ".xls"):
        sheets = pd.read_excel(io.BytesIO(data), sheet_name=None, dtype=object)
        frames = [(stem if len(sheets) == 1 else f"{stem} - {n}", df) for n, df in sheets.items()]
    elif ext in (".json", ".jsonl"):
        text = _decode(data)
        if ext == ".jsonl":
            payload = [json.loads(line) for line in text.splitlines() if line.strip()]
        else:
            payload = json.loads(text)
        if isinstance(payload, dict):
            lists = [v for v in payload.values() if isinstance(v, list) and v and isinstance(v[0], dict)]
            if len(lists) == 1:
                payload = lists[0]
            else:
                payload = [payload]
        if not isinstance(payload, list) or not all(isinstance(r, dict) for r in payload):
            raise UnsupportedFile("JSON must be an array of objects to be loaded as a table")
        frames = [(stem, pd.json_normalize(payload))]
    else:
        raise UnsupportedFile(f"Not a tabular file: {filename}")

    out = [(n, _tidy(df)) for n, df in frames]
    out = [(n, df) for n, df in out if len(df) and len(df.columns)]
    if not out:
        raise UnsupportedFile("The file contains no rows")
    return out


def extract_pages(filename: str, data: bytes) -> list[tuple[int | None, str]]:
    ext = PurePath(filename).suffix.lower()
    if ext == ".pdf":
        from pypdf import PdfReader

        reader = PdfReader(io.BytesIO(data))
        pages = [(i + 1, (p.extract_text() or "").strip()) for i, p in enumerate(reader.pages)]
    elif ext == ".docx":
        from docx import Document

        doc = Document(io.BytesIO(data))
        pages = [(None, "\n\n".join(p.text for p in doc.paragraphs if p.text.strip()))]
    else:
        pages = [(None, _decode(data))]
    pages = [(n, t) for n, t in pages if t.strip()]
    if not pages:
        raise UnsupportedFile("No extractable text found (scanned PDFs need OCR)")
    return pages


def chunk_text(text: str, size: int, overlap: int) -> list[str]:
    paras = [p.strip() for p in text.replace("\r", "").split("\n\n") if p.strip()]
    pieces: list[str] = []
    for p in paras:
        if len(p) <= size:
            pieces.append(p)
            continue
        words, cur = p.split(" "), ""
        for w in words:
            if cur and len(cur) + len(w) + 1 > size:
                pieces.append(cur)
                cur = w
            else:
                cur = f"{cur} {w}".strip()
        if cur:
            pieces.append(cur)

    chunks: list[str] = []
    cur = ""
    for piece in pieces:
        if cur and len(cur) + len(piece) + 2 > size:
            chunks.append(cur)
            tail = cur[-overlap:] if overlap else ""
            cur = (tail[tail.find(" ") + 1:] + "\n\n" + piece) if tail else piece
        else:
            cur = f"{cur}\n\n{piece}" if cur else piece
    if cur.strip():
        chunks.append(cur)
    return chunks
