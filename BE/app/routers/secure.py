from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.security import transport

router = APIRouter(prefix="/secure", tags=["secure"])


class HandshakeBody(BaseModel):
    client_pub: str = Field(max_length=200, description="base64 of the uncompressed P-256 point")


@router.post("/handshake")
async def handshake(body: HandshakeBody) -> dict:
    """Establish an encrypted session. The reply is signed with the server's long-term key, which the browser has pinned."""
    try:
        return transport.handshake(body.client_pub)
    except transport.TransportError as e:
        raise HTTPException(e.status, e.detail) from e
