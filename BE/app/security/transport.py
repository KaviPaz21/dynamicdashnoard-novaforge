"""Application-layer encrypted transport between the Next.js app and the API.

Handshake (POST /api/secure/handshake, plaintext, public values only)
  browser: ephemeral ECDH P-256 key pair -> sends its public key
  server : ephemeral ECDH P-256 key pair; shared secret = ECDH(server_priv, client_pub)
           HKDF-SHA256(secret, salt=random 32 B, info="novaforge-transport-v1|<sid>") -> 64 B -> two AES-256-GCM keys
           (client->server, server->client); replies with its public key, the salt, the session id and an ECDSA P-256
           signature over (client_pub || server_pub || salt || sid) made with a long-term key whose public half is pinned
           in the browser build (NEXT_PUBLIC_SECURE_SIGNING_PUBKEY). Fresh keys per session => forward secrecy; the
           signature stops a man in the middle from substituting its own key.

Every later API call is tunnelled through POST /api/secure/call:
  request  body = nonce(12) || AES-GCM( u32 len(meta) || meta-json || body ),  AAD = "nf1|req|<sid>|<ts>"
           meta = {m: method, p: path+query, h: {content-type, authorization}}  -> method, path, query, bearer token and
           payload are all inside the ciphertext, nothing but the session id and timestamp is readable on the wire.
  response body = nonce || AES-GCM( u32 len(meta) || meta-json || body ),  AAD = "nf1|res|<sid>|<request nonce>"
           meta = {s: status, h: {content-type, ...}}
  event streams are sent as SSE-shaped frames `data: <b64(nonce||ct)>`, one per chunk, AAD "nf1|str|<sid>|<req nonce>|<seq>"
Replay protection: timestamp window + per-session nonce cache. The tunnelled request is then handed to the normal app.
"""

from __future__ import annotations

import base64
import json
import logging
import os
import secrets
import struct
import time
from collections import OrderedDict
from dataclasses import dataclass, field
from urllib.parse import unquote, urlsplit

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from app.config import get_settings

log = logging.getLogger("novaforge.transport")

INFO = b"novaforge-transport-v1|"
NONCE_LEN = 12
CALL = "/secure/call"
HANDSHAKE = "/secure/handshake"
PLAIN_ALLOWED = {"/health", HANDSHAKE}
_METHODS = {"GET", "POST", "PUT", "PATCH", "DELETE"}
_REQ_HEADERS = {"content-type", "authorization", "accept"}
_RES_HEADERS = {"content-type", "content-disposition", "retry-after", "www-authenticate"}
_MAX_SESSIONS = 5000


class TransportError(Exception):
    def __init__(self, status: int, detail: str, code: str = "bad-request") -> None:
        super().__init__(detail)
        self.status, self.detail, self.code = status, detail, code


@dataclass
class Session:
    sid: str
    c2s: AESGCM
    s2c: AESGCM
    expires: float
    seen: "OrderedDict[bytes, float]" = field(default_factory=OrderedDict)


_sessions: dict[str, Session] = {}
_signing_key: ec.EllipticCurvePrivateKey | None = None


def _b64d(s: str) -> bytes:
    return base64.b64decode(s + "=" * (-len(s) % 4))


def signing_key() -> ec.EllipticCurvePrivateKey:
    global _signing_key
    if _signing_key is None:
        raw = get_settings().secure_signing_key
        if raw:
            key = serialization.load_der_private_key(_b64d(raw), password=None)
            if not isinstance(key, ec.EllipticCurvePrivateKey):
                raise RuntimeError("SECURE_SIGNING_KEY must be an EC P-256 private key")
            _signing_key = key
        else:
            _signing_key = ec.generate_private_key(ec.SECP256R1())
            log.warning(
                "SECURE_SIGNING_KEY not set: generated a throwaway key. Run scripts/gen_secrets.py and pin the public "
                "key in FE/.env.local (NEXT_PUBLIC_SECURE_SIGNING_PUBKEY)"
            )
    return _signing_key


def public_point(key: ec.EllipticCurvePrivateKey | ec.EllipticCurvePublicKey) -> bytes:
    pub = key.public_key() if isinstance(key, ec.EllipticCurvePrivateKey) else key
    return pub.public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)


def _sign(data: bytes) -> bytes:
    r, s = decode_dss_signature(signing_key().sign(data, ec.ECDSA(hashes.SHA256())))
    return r.to_bytes(32, "big") + s.to_bytes(32, "big")  # IEEE P1363, what WebCrypto verifies


def _prune(now: float) -> None:
    for sid in [k for k, v in _sessions.items() if v.expires < now]:
        _sessions.pop(sid, None)
    while len(_sessions) >= _MAX_SESSIONS:
        _sessions.pop(next(iter(_sessions)))


def handshake(client_pub_b64: str) -> dict:
    try:
        client_pub = _b64d(client_pub_b64)
        if len(client_pub) != 65 or client_pub[0] != 4:
            raise ValueError
        peer = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), client_pub)
    except Exception as e:
        raise TransportError(400, "Invalid client public key") from e

    eph = ec.generate_private_key(ec.SECP256R1())
    secret = eph.exchange(ec.ECDH(), peer)
    salt, sid = os.urandom(32), secrets.token_urlsafe(16)
    okm = HKDF(algorithm=hashes.SHA256(), length=64, salt=salt, info=INFO + sid.encode()).derive(secret)
    server_pub = public_point(eph)
    now = time.time()
    ttl = get_settings().secure_session_minutes * 60
    _prune(now)
    _sessions[sid] = Session(sid, AESGCM(okm[:32]), AESGCM(okm[32:]), now + ttl)
    return {
        "sid": sid,
        "server_pub": base64.b64encode(server_pub).decode(),
        "salt": base64.b64encode(salt).decode(),
        "sig": base64.b64encode(_sign(client_pub + server_pub + salt + sid.encode())).decode(),
        "server_time": int(now * 1000),
        "expires_in": ttl,
    }


def _session(sid: str) -> Session:
    s = _sessions.get(sid)
    if s is None or s.expires < time.time():
        _sessions.pop(sid, None)
        raise TransportError(401, "Secure session expired", "session")
    return s


def pack(meta: dict, body: bytes) -> bytes:
    m = json.dumps(meta, separators=(",", ":")).encode()
    return struct.pack(">I", len(m)) + m + body


def unpack(blob: bytes) -> tuple[dict, bytes]:
    (n,) = struct.unpack(">I", blob[:4])
    if n > len(blob) - 4:
        raise ValueError("bad frame")
    return json.loads(blob[4 : 4 + n]), blob[4 + n :]


def seal(key: AESGCM, plaintext: bytes, aad: bytes) -> bytes:
    nonce = os.urandom(NONCE_LEN)
    return nonce + key.encrypt(nonce, plaintext, aad)


def open_request(sid: str, ts: str, body: bytes) -> tuple[Session, bytes, dict, bytes]:
    """Authenticate + decrypt a tunnelled request. Returns (session, request nonce, meta, inner body)."""
    s = get_settings()
    sess = _session(sid)
    try:
        skew = abs(time.time() * 1000 - int(ts)) / 1000
    except ValueError as e:
        raise TransportError(400, "Bad timestamp") from e
    if skew > s.secure_clock_skew_seconds:
        raise TransportError(400, "Request timestamp outside the allowed window", "clock")
    if len(body) < NONCE_LEN + 16 + 4:
        raise TransportError(400, "Malformed secure request")
    nonce = body[:NONCE_LEN]
    if nonce in sess.seen:
        raise TransportError(400, "Replayed request", "replay")
    try:
        plain = sess.c2s.decrypt(nonce, body[NONCE_LEN:], b"nf1|req|" + sid.encode() + b"|" + ts.encode())
        meta, inner = unpack(plain)
    except (InvalidTag, ValueError, struct.error) as e:
        raise TransportError(400, "Could not decrypt the request", "decrypt") from e
    now = time.time()
    sess.seen[nonce] = now
    while sess.seen and next(iter(sess.seen.values())) < now - 2 * s.secure_clock_skew_seconds:
        sess.seen.popitem(last=False)
    return sess, nonce, meta, inner


def _res_aad(sid: str, nonce: bytes) -> bytes:
    return b"nf1|res|" + sid.encode() + b"|" + nonce.hex().encode()


def _str_aad(sid: str, nonce: bytes, seq: int) -> bytes:
    return b"nf1|str|" + sid.encode() + b"|" + nonce.hex().encode() + b"|" + struct.pack(">I", seq)


def _inner_target(meta: dict, prefix: str) -> tuple[str, str, str, str]:
    method = str(meta.get("m", "")).upper()
    target = str(meta.get("p", ""))
    if method not in _METHODS:
        raise TransportError(400, "Unsupported method")
    parts = urlsplit(target)
    path = unquote(parts.path)
    if (
        parts.scheme or parts.netloc or not path.startswith(prefix + "/") or path.startswith(prefix + CALL)
        or ".." in path.split("/") or "\\" in path or "\x00" in path
    ):
        raise TransportError(400, "Invalid target")
    return method, path, parts.path, parts.query


async def _read_body(receive, limit: int) -> bytes:
    chunks, size = [], 0
    while True:
        msg = await receive()
        if msg["type"] == "http.disconnect":
            raise TransportError(400, "Client disconnected")
        chunk = msg.get("body", b"")
        size += len(chunk)
        if size > limit:
            raise TransportError(413, "Request too large")
        chunks.append(chunk)
        if not msg.get("more_body"):
            return b"".join(chunks)


async def _plain(send, status: int, detail: str, code: str | None = None) -> None:
    body = json.dumps({"detail": detail}).encode()
    headers = [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())]
    if code:
        headers.append((b"x-nf-err", code.encode()))
    await send({"type": "http.response.start", "status": status, "headers": headers})
    await send({"type": "http.response.body", "body": body})


class SecureTransportMiddleware:
    def __init__(self, app) -> None:
        self.app = app

    async def __call__(self, scope, receive, send) -> None:
        s = get_settings()
        if scope["type"] != "http" or s.secure_transport == "off" or not scope["path"].startswith(s.api_prefix + "/"):
            return await self.app(scope, receive, send)
        rel = scope["path"][len(s.api_prefix) :]
        if rel == CALL:
            return await self._tunnel(scope, receive, send)
        if s.secure_transport == "required" and rel not in PLAIN_ALLOWED:
            return await _plain(send, 426, "Encrypted transport required: call the API through /secure/call", "required")
        return await self.app(scope, receive, send)

    async def _tunnel(self, scope, receive, send) -> None:
        s = get_settings()
        hdr = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope["headers"]}
        try:
            if scope["method"] != "POST":
                raise TransportError(405, "Use POST")
            body = await _read_body(receive, s.max_upload_mb * 1024 * 1024 + 2 * 1024 * 1024)
            sid = hdr.get("x-nf-sid", "")
            sess, req_nonce, meta, inner = open_request(sid, hdr.get("x-nf-ts", ""), body)
            method, path, raw_path, query = _inner_target(meta, s.api_prefix)
        except TransportError as e:
            return await _plain(send, e.status, e.detail, e.code)

        drop = {b"x-nf-sid", b"x-nf-ts", b"content-type", b"content-length", b"authorization", b"transfer-encoding"}
        headers = [(k, v) for k, v in scope["headers"] if k not in drop]
        for k, v in (meta.get("h") or {}).items():
            if str(k).lower() in _REQ_HEADERS:
                headers.append((str(k).lower().encode("latin-1"), str(v).encode("latin-1")))
        headers.append((b"content-length", str(len(inner)).encode()))
        inner_scope = {
            **scope, "method": method, "path": path, "raw_path": raw_path.encode(), "query_string": query.encode(),
            "headers": headers,
        }

        delivered = False

        async def inner_receive():
            nonlocal delivered
            if not delivered:
                delivered = True
                return {"type": "http.request", "body": inner, "more_body": False}
            return await receive()  # blocks until the client goes away, as a real receive would

        status, res_headers, chunks, started, streaming, seq = 500, {}, [], False, False, 0

        async def emit_frame(plain: bytes) -> None:
            nonlocal seq
            blob = seal(sess.s2c, plain, _str_aad(sid, req_nonce, seq))
            seq += 1
            await send({"type": "http.response.body", "body": b"data: " + base64.b64encode(blob) + b"\n\n", "more_body": True})

        async def inner_send(msg) -> None:
            nonlocal status, res_headers, started, streaming
            if msg["type"] == "http.response.start":
                status = msg["status"]
                res_headers = {
                    k.decode("latin-1").lower(): v.decode("latin-1")
                    for k, v in msg.get("headers", [])
                    if k.decode("latin-1").lower() in _RES_HEADERS
                }
                streaming = res_headers.get("content-type", "").startswith("text/event-stream")
                started = True
                if streaming:
                    await send({
                        "type": "http.response.start", "status": 200,
                        "headers": [
                            (b"content-type", b"text/event-stream"), (b"cache-control", b"no-store"),
                            (b"x-accel-buffering", b"no"), (b"x-nf-enc", b"stream"),
                        ],
                    })
                    await emit_frame(pack({"s": status, "h": res_headers}, b""))
            elif msg["type"] == "http.response.body":
                data, more = msg.get("body", b""), msg.get("more_body", False)
                if streaming:
                    if data:
                        await emit_frame(data)
                    if not more:
                        await send({"type": "http.response.body", "body": b"", "more_body": False})
                else:
                    chunks.append(data)
                    if not more:
                        await self._send_buffered(send, sess, sid, req_nonce, status, res_headers, b"".join(chunks))

        try:
            await self.app(inner_scope, inner_receive, inner_send)
        except Exception:
            log.exception("Unhandled error in tunnelled request %s %s", method, path)
            if started:
                raise
            await self._send_buffered(
                send, sess, sid, req_nonce, 500, {"content-type": "application/json"},
                b'{"detail":"Internal server error"}',
            )

    @staticmethod
    async def _send_buffered(send, sess: Session, sid: str, nonce: bytes, status: int, headers: dict, body: bytes) -> None:
        blob = seal(sess.s2c, pack({"s": status, "h": headers}, body), _res_aad(sid, nonce))
        await send({
            "type": "http.response.start", "status": 200,
            "headers": [
                (b"content-type", b"application/octet-stream"), (b"cache-control", b"no-store"), (b"x-nf-enc", b"1"),
                (b"content-length", str(len(blob)).encode()),
            ],
        })
        await send({"type": "http.response.body", "body": blob})
