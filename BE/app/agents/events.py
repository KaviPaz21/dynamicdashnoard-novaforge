from __future__ import annotations

import time
from typing import Any

from langgraph.config import get_stream_writer


def emit(kind: str, node: str, title: str, detail: str | None = None, data: dict[str, Any] | None = None) -> None:
    """Send a human-readable trace entry to the browser while the graph is still running.

    kind: guard | select | thought | query | retry | retrieval | info.
    Outside a running graph (unit tests calling a node directly) this is a no-op."""
    try:
        writer = get_stream_writer()
    except RuntimeError:
        return
    writer({"kind": kind, "node": node, "title": title, "detail": detail, "data": data or {}, "ts": int(time.time() * 1000)})
