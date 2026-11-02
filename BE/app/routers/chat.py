from __future__ import annotations

import json
import uuid
from typing import Any, AsyncIterator

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from app.agents.chat_graph import get_graph
from app.db.store import get_store
from app.llm import LLMUnavailable
from app.schemas import ChatRequest, ChatResponse, utcnow

router = APIRouter(tags=["chat"])


async def _persist(req: ChatRequest, res: ChatResponse) -> None:
    store = await get_store()
    conv = await store.get("conversations", res.conversation_id) or {
        "id": res.conversation_id,
        "title": req.message[:60],
        "created_at": utcnow(),
        "messages": [],
    }
    now = utcnow()
    conv["messages"] += [
        {"role": "user", "content": req.message, "ts": now},
        {
            "role": "assistant",
            "content": res.message,
            "ts": now,
            "intent": res.intent,
            "widget_titles": [w.title for w in res.widgets],
            "citations": [c.model_dump() for c in res.citations],
            "suggestions": res.suggestions,
        },
    ]
    conv["updated_at"] = now
    await store.upsert("conversations", conv)


def _describe(node: str, delta: dict[str, Any]) -> str:
    if node == "route":
        r = delta["route"]
        parts = [r.intent]
        if r.needs_data_queries:
            parts.append("query tables")
        if r.needs_documents:
            parts.append("search documents")
        parts.append("KPIs" if r.needs_kpis else "no KPIs")
        return " · ".join(parts)
    if node == "plan_widgets":
        p = delta["plan"]
        return f"{len(p.widgets)} widgets, {len(p.analysis_queries)} analysis queries"
    if node == "execute_queries":
        return f"{len(delta['widgets'])} ready" + (f", {len(delta['errors'])} issues" if delta["errors"] else "")
    if node == "retrieve_docs":
        return f"{len(delta['chunks'])} passages"
    return ""


@router.post("/chat")
async def chat(req: ChatRequest) -> ChatResponse:
    req.conversation_id = req.conversation_id or uuid.uuid4().hex
    try:
        out = await get_graph().ainvoke({"request": req})
    except LLMUnavailable as e:
        raise HTTPException(503, str(e)) from e
    res: ChatResponse = out["response"]
    res.conversation_id = req.conversation_id
    await _persist(req, res)
    return res


def _sse(event: str, data: Any) -> str:
    return f"event: {event}\ndata: {json.dumps(data, default=str)}\n\n"


@router.post("/chat/stream")
async def chat_stream(req: ChatRequest) -> StreamingResponse:
    req.conversation_id = req.conversation_id or uuid.uuid4().hex

    async def gen() -> AsyncIterator[str]:
        yield _sse("start", {"conversation_id": req.conversation_id})
        final: ChatResponse | None = None
        try:
            async for update in get_graph().astream({"request": req}, stream_mode="updates"):
                for node, delta in update.items():
                    delta = delta or {}
                    yield _sse("step", {"node": node, "detail": _describe(node, delta)})
                    if "response" in delta:
                        final = delta["response"]
            if final is None:
                raise RuntimeError("The agent finished without a response")
            final.conversation_id = req.conversation_id or ""
            await _persist(req, final)
            yield _sse("final", final.model_dump())
        except LLMUnavailable as e:
            yield _sse("error", {"message": str(e), "status": 503})
        except Exception as e:
            yield _sse("error", {"message": f"{type(e).__name__}: {e}", "status": 500})

    return StreamingResponse(
        gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
    )


@router.get("/conversations")
async def list_conversations() -> list[dict]:
    store = await get_store()
    convs = await store.list_all("conversations")
    convs.sort(key=lambda c: c.get("updated_at", ""), reverse=True)
    return [{"id": c["id"], "title": c.get("title", ""), "updated_at": c.get("updated_at")} for c in convs]


@router.get("/conversations/{conv_id}")
async def get_conversation(conv_id: str) -> dict:
    conv = await (await get_store()).get("conversations", conv_id)
    if not conv:
        raise HTTPException(404, "Conversation not found")
    return conv


@router.delete("/conversations/{conv_id}", status_code=204)
async def delete_conversation(conv_id: str) -> None:
    await (await get_store()).delete("conversations", conv_id)
