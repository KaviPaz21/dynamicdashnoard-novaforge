from __future__ import annotations

import logging
import uuid

from app.agents.guard import Verdict
from app.db.store import get_store
from app.schemas import FlagDoc, UserDoc

log = logging.getLogger("novaforge.flags")


async def record(user: UserDoc, verdict: Verdict, prompt: str, response: str, conversation_id: str) -> FlagDoc:
    """Store a flagged prompt for the administrators (shown in the Flagging view, counted on the Admin button)."""
    flag = FlagDoc(
        id=uuid.uuid4().hex, user_id=user.id, user_name=user.name, user_email=user.email,
        conversation_id=conversation_id, prompt=prompt[:8000], response=response[:8000],
        categories=verdict.categories, severity=verdict.severity if verdict.severity != "none" else "low",  # type: ignore[arg-type]
        reason=verdict.reason, blocked=verdict.blocked, detection=verdict.detection,
    )
    await (await get_store()).upsert("flags", flag.model_dump())
    log.warning("FLAGGED prompt user=%s (%s) severity=%s categories=%s", user.id, user.name, flag.severity, flag.categories)
    return flag


async def unreviewed_count() -> int:
    return len(await (await get_store()).query("flags", reviewed=False))
