from __future__ import annotations

import asyncio
import json
import logging
import re
import uuid
from typing import Any, AsyncIterator

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response, StreamingResponse

from app.agents.chat_graph import get_graph
from app.agents.guard import Verdict
from app.db.store import get_store
from app.llm import LLMUnavailable, track_usage, usage_totals
from app.schemas import ChatRequest, ChatResponse, UserDoc, utcnow
from app.security.deps import current_user
from app.services import access, flags, users
from app.services.titles import fallback_title, make_title

log = logging.getLogger("novaforge.chat")
router = APIRouter(tags=["chat"], dependencies=[Depends(current_user)])

CONV_ID = re.compile(r"^[0-9a-f]{32}$")
MAX_MESSAGE = 8000
FLAGGED_TITLE = "Flagged request"


def _trim_trace(trace: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """What is kept with the message: enough to replay the agent's reasoning without bloating the conversation."""
    return [{**e, "detail": (e.get("detail") or "")[:600]} for e in trace[:60]]


async def _owned(conv_id: str, user: UserDoc) -> dict[str, Any]:
    conv = await (await get_store()).get("conversations", conv_id)
    if not conv or conv.get("owner_id") != user.id:
        raise HTTPException(404, "Conversation not found")  # someone else's chat looks exactly like a missing one
    return conv


async def _events(req: ChatRequest, user: UserDoc, conv: dict[str, Any] | None) -> AsyncIterator[tuple[str, Any]]:
    store = await get_store()
    conv_id = req.conversation_id or ""
    is_new = conv is None
    usage = track_usage()
    title_task = asyncio.create_task(make_title(req.message)) if is_new else None
    trace: list[dict[str, Any]] = []
    verdict = Verdict()
    final: ChatResponse | None = None
    yield "start", {"conversation_id": conv_id}
    try:
        async for mode, payload in get_graph().astream(
            {"request": req, "user": user}, stream_mode=["updates", "custom"]
        ):
            if mode == "custom":
                trace.append(payload)
                yield "trace", payload
                continue
            for node, delta in payload.items():
                delta = delta or {}
                yield "step", {"node": node}
                if "verdict" in delta:
                    verdict = delta["verdict"]
                if "response" in delta:
                    final = delta["response"]
        if final is None:
            raise RuntimeError("The agent finished without a response")
        final.conversation_id = conv_id
        final.trace = _trim_trace(trace)

        title = conv["title"] if conv else None
        if title_task:
            title = FLAGGED_TITLE if final.blocked else await title_task
        final.title = title
        in_tok, out_tok = usage_totals(usage)

        now = utcnow()
        names = [
            s.name or s.filename
            for s in await access.chat_sources(store, user, req.kb_scope, req.attachment_ids)
            if s.id in set(req.attachment_ids)
        ]
        conv = conv or {"id": conv_id, "owner_id": user.id, "title": title, "created_at": now, "messages": []}
        conv["title"] = title or conv.get("title") or fallback_title(req.message)
        conv["messages"] += [
            {"role": "user", "content": req.message, "ts": now, "attachments": names, "kb_scope": req.kb_scope},
            {
                "role": "assistant", "content": final.message, "ts": now, "intent": final.intent,
                "widget_titles": [w.title for w in final.widgets], "citations": [c.model_dump() for c in final.citations],
                "suggestions": final.suggestions, "trace": final.trace, "blocked": final.blocked,
                "tokens": {"in": in_tok, "out": out_tok},
            },
        ]
        conv["updated_at"] = now
        await store.upsert("conversations", conv)

        if verdict.flagged:
            await flags.record(user, verdict, req.message, final.message, conv_id)
        await users.record_usage(
            user.id, tokens_in=in_tok, tokens_out=out_tok, prompts=1, sessions=1 if is_new else 0,
            flagged=1 if verdict.flagged else 0,
        )
        if title:
            yield "title", {"id": conv_id, "title": conv["title"]}
        yield "final", final.model_dump()
    except LLMUnavailable:
        log.exception("assistant unavailable")
        yield "error", {"message": "The assistant is unavailable right now. Please try again shortly.", "status": 503}
    except Exception:
        log.exception("chat failed")
        yield "error", {"message": "Something went wrong while answering. Please try again.", "status": 500}
    finally:
        if title_task and not title_task.done():
            title_task.cancel()


async def _prepare(req: ChatRequest, user: UserDoc) -> dict[str, Any] | None:
    req.message = req.message.strip()
    if not req.message:
        raise HTTPException(400, "Message is empty")
    if len(req.message) > MAX_MESSAGE:
        raise HTTPException(400, f"Message is too long (max {MAX_MESSAGE:,} characters)")
    req.conversation_id = req.conversation_id or uuid.uuid4().hex
    if not CONV_ID.match(req.conversation_id):
        raise HTTPException(400, "Invalid conversation id")
    conv = await (await get_store()).get("conversations", req.conversation_id)
    if conv and conv.get("owner_id") != user.id:
        raise HTTPException(404, "Conversation not found")
    return conv


@router.post("/chat")
async def chat(req: ChatRequest, user: UserDoc = Depends(current_user)) -> ChatResponse:
    conv = await _prepare(req, user)
    final: ChatResponse | None = None
    async for event, data in _events(req, user, conv):
        if event == "final":
            final = ChatResponse(**data)
        elif event == "error":
            raise HTTPException(data.get("status", 500), data["message"])
    if final is None:
        raise HTTPException(500, "The agent finished without a response")
    return final


def _sse(event: str, data: Any) -> str:
    return f"event: {event}\ndata: {json.dumps(data, default=str)}\n\n"


@router.post("/chat/stream")
async def chat_stream(req: ChatRequest, user: UserDoc = Depends(current_user)) -> StreamingResponse:
    conv = await _prepare(req, user)

    async def gen() -> AsyncIterator[str]:
        async for event, data in _events(req, user, conv):
            yield _sse(event, data)

    return StreamingResponse(
        gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
    )


@router.get("/conversations")
async def list_conversations(user: UserDoc = Depends(current_user)) -> list[dict]:
    convs = await (await get_store()).query("conversations", owner_id=user.id)
    convs.sort(key=lambda c: c.get("updated_at", ""), reverse=True)
    return [
        {"id": c["id"], "title": c.get("title", ""), "updated_at": c.get("updated_at"), "messages": len(c.get("messages", []))}
        for c in convs
    ]


@router.get("/conversations/{conv_id}")
async def get_conversation(conv_id: str, user: UserDoc = Depends(current_user)) -> dict:
    return await _owned(conv_id, user)


@router.delete("/conversations/{conv_id}", status_code=204)
async def delete_conversation(conv_id: str, user: UserDoc = Depends(current_user)) -> None:
    await _owned(conv_id, user)
    await (await get_store()).delete("conversations", conv_id)


@router.get("/conversations/{conv_id}/export")
async def export_conversation(conv_id: str, user: UserDoc = Depends(current_user)) -> Response:
    conv = await _owned(conv_id, user)
    try:
        from app.services.pdf_export import build_conversation_pdf
    except ImportError as e:
        raise HTTPException(501, "PDF export needs the 'reportlab' package: pip install -r requirements.txt") from e
    pdf = await asyncio.to_thread(build_conversation_pdf, conv, user)
    safe = re.sub(r"[^A-Za-z0-9._-]+", "-", conv.get("title") or "conversation").strip("-")[:60] or "conversation"
    return Response(pdf, media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="NovaForge-{safe}.pdf"'})
