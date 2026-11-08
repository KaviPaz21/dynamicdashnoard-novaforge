"""Start-up work: make sure an administrator exists, give pre-login data an owner, finish interrupted deletes."""

from __future__ import annotations

import logging

from app.config import get_settings
from app.db.store import get_store
from app.security.passwords import hash_password_async, password_problem
from app.services import sources as lifecycle
from app.services import users

log = logging.getLogger("novaforge.bootstrap")


async def ensure_admin() -> str | None:
    """Create the first administrator from ADMIN_EMAIL / ADMIN_PASSWORD when the user table is empty. Returns its id."""
    s = get_settings()
    existing = await users.list_users()
    admins = [u for u in existing if u.role == "admin" and u.active]
    if admins:
        return admins[0].id
    if existing or not (s.admin_email and s.admin_password):
        log.warning("No active administrator exists. Set ADMIN_EMAIL and ADMIN_PASSWORD in BE/.env and restart.")
        return None
    if (problem := password_problem(s.admin_password)):
        log.error("ADMIN_PASSWORD rejected: %s", problem)
        return None
    admin = await users.create_user(
        name=s.admin_name, email=s.admin_email, role="admin", password_hash=await hash_password_async(s.admin_password),
        created_by=None, must_change=False,
    )
    log.warning("Created the first administrator %s (%s)", admin.email, admin.id)
    return admin.id


async def adopt_orphans(owner_id: str) -> dict[str, int]:
    """Data created before sign-in existed has no owner. It becomes the first administrator's private data
    (nothing is deleted or made public); each user only ever sees their own."""
    store = await get_store()
    owner = await users.get_user(owner_id)
    counts = {"sources": 0, "dashboards": 0, "conversations": 0}
    for container in counts:
        for doc in await store.list_all(container):
            if doc.get("owner_id"):
                continue
            doc["owner_id"] = owner_id
            if container == "sources":
                doc.setdefault("visibility", "private")
                doc["owner_name"] = owner.name if owner else ""
            await store.upsert(container, doc)
            counts[container] += 1
    if any(counts.values()):
        log.warning("Adopted data created before sign-in for %s: %s", owner_id, counts)
    return counts


async def run() -> None:
    try:
        admin_id = await ensure_admin()
        if admin_id:
            await adopt_orphans(admin_id)
        finished = await lifecycle.finish_pending_deletes()
        if finished:
            log.info("Finished %d interrupted source deletions", finished)
    except Exception:
        log.exception("start-up bootstrap failed")
