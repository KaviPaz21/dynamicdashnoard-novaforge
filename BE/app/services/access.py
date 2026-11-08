"""Who may see or change which knowledge source.

A source is either `global` (uploaded by an administrator, readable by everyone) or `private` (readable and writable by its
owner only). Administrators get no peek into other users' private knowledge. Every router goes through these helpers; ids sent
by the browser are never trusted on their own.
"""

from __future__ import annotations

from typing import Any

from fastapi import HTTPException

from app.db.store import Store
from app.schemas import KbScope, SourceDoc, UserDoc


def can_read(src: SourceDoc, user: UserDoc) -> bool:
    return src.status != "deleting" and (src.visibility == "global" or src.owner_id == user.id)


def can_write(src: SourceDoc, user: UserDoc) -> bool:
    if src.visibility == "global":
        return user.role == "admin"
    return src.owner_id == user.id


async def readable_sources(store: Store, user: UserDoc) -> list[SourceDoc]:
    docs = [SourceDoc(**d) for d in await store.list_all("sources")]
    return [d for d in docs if can_read(d, user)]


async def get_readable(store: Store, source_id: str, user: UserDoc) -> SourceDoc:
    raw = await store.get("sources", source_id)
    src = SourceDoc(**raw) if raw else None
    if src is None or not can_read(src, user):
        raise HTTPException(404, "Source not found")  # same answer for "missing" and "not yours"
    return src


async def get_writable(store: Store, source_id: str, user: UserDoc) -> SourceDoc:
    src = await get_readable(store, source_id, user)
    if not can_write(src, user):
        raise HTTPException(403, "Only an administrator can change global knowledge")
    return src


def in_scope(src: SourceDoc, scope: KbScope, user: UserDoc, attachments: set[str]) -> bool:
    """Is this source offered to the assistant for the chosen knowledge setting? Files attached to the chat always are."""
    if src.id in attachments:
        return True
    if src.conversation_id and src.visibility == "private":
        return False  # another chat's attachment: only that chat sees it
    if scope == "local":
        return src.visibility == "private" and src.owner_id == user.id
    if scope == "global":
        return src.visibility == "global"
    return True


async def chat_sources(store: Store, user: UserDoc, scope: KbScope, attachment_ids: list[str]) -> list[SourceDoc]:
    attached = set(attachment_ids)
    return [s for s in await readable_sources(store, user) if in_scope(s, scope, user, attached)]


def visible_relationships(rels: list[Any], readable_ids: set[str]) -> list[Any]:
    return [r for r in rels if r.from_source in readable_ids and r.to_source in readable_ids]
