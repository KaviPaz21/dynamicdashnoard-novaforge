"""The encrypted tunnel, exercised by an independent client implementation of the documented protocol."""

from __future__ import annotations

import base64
import json
import os
import struct
import time

import httpx
import pytest
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from app.config import get_settings
from app.security import transport
from tests.conftest import PASSWORDS
from tests.test_api import scripted_llm

b64 = lambda b: base64.b64encode(b).decode()  # noqa: E731


class Tunnel:
    def __init__(self, client: httpx.AsyncClient) -> None:
        self.client = client
        self.wire: list[bytes] = []  # everything that crossed the network, both directions

    async def connect(self, pinned_pub: bytes | None = None) -> "Tunnel":
        priv = ec.generate_private_key(ec.SECP256R1())
        mine = transport.public_point(priv)
        r = await self.client.post("/api/secure/handshake", json={"client_pub": b64(mine)})
        assert r.status_code == 200, r.text
        j = r.json()
        server_pub, salt, sid = base64.b64decode(j["server_pub"]), base64.b64decode(j["salt"]), j["sid"]
        sig = base64.b64decode(j["sig"])
        pinned = ec.EllipticCurvePublicKey.from_encoded_point(
            ec.SECP256R1(), pinned_pub or transport.public_point(transport.signing_key())
        )
        pinned.verify(encode_dss_signature(int.from_bytes(sig[:32], "big"), int.from_bytes(sig[32:], "big")),
                      mine + server_pub + salt + sid.encode(), ec.ECDSA(hashes.SHA256()))
        secret = priv.exchange(ec.ECDH(), ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), server_pub))
        okm = HKDF(algorithm=hashes.SHA256(), length=64, salt=salt, info=transport.INFO + sid.encode()).derive(secret)
        self.sid, self.c2s, self.s2c = sid, AESGCM(okm[:32]), AESGCM(okm[32:])
        return self

    def build(self, method: str, path: str, body: bytes = b"", headers: dict | None = None, ts: str | None = None):
        ts = ts or str(int(time.time() * 1000))
        nonce = os.urandom(12)
        plain = transport.pack({"m": method, "p": path, "h": headers or {}}, body)
        blob = nonce + self.c2s.encrypt(nonce, plain, b"nf1|req|" + self.sid.encode() + b"|" + ts.encode())
        return blob, {"X-NF-Sid": self.sid, "X-NF-Ts": ts}, nonce

    async def send(self, blob: bytes, hdrs: dict) -> httpx.Response:
        self.wire.append(blob)
        r = await self.client.post("/api/secure/call", content=blob, headers=hdrs)
        self.wire.append(r.content)
        return r

    async def call(self, method: str, path: str, json_body=None, token: str | None = None, raw: bytes | None = None, ctype: str | None = None):
        headers = {}
        body = raw if raw is not None else b""
        if json_body is not None:
            body, ctype = json.dumps(json_body).encode(), "application/json"
        if ctype:
            headers["content-type"] = ctype
        if token:
            headers["authorization"] = f"Bearer {token}"
        blob, hdrs, nonce = self.build(method, path, body, headers)
        r = await self.send(blob, hdrs)
        assert r.status_code == 200, (r.status_code, r.text)
        meta, inner = transport.unpack(self.s2c.decrypt(r.content[:12], r.content[12:], transport._res_aad(self.sid, nonce)))
        return meta["s"], meta["h"], inner

    async def stream(self, path: str, json_body, token: str):
        blob, hdrs, nonce = self.build("POST", path, json.dumps(json_body).encode(), {"content-type": "application/json", "authorization": f"Bearer {token}"})
        self.wire.append(blob)
        async with self.client.stream("POST", "/api/secure/call", content=blob, headers=hdrs) as r:
            assert r.status_code == 200 and r.headers["x-nf-enc"] == "stream"
            raw = (await r.aread()).decode()
        self.wire.append(raw.encode())
        frames = [base64.b64decode(line[6:]) for line in raw.split("\n\n") if line.startswith("data: ")]
        plain = [self.s2c.decrypt(f[:12], f[12:], transport._str_aad(self.sid, nonce, i)) for i, f in enumerate(frames)]
        meta, first = transport.unpack(plain[0])
        return meta, b"".join([first] + plain[1:]).decode()


@pytest.fixture
async def secure(world, monkeypatch):
    monkeypatch.setattr(get_settings(), "secure_transport", "required")
    return world, await Tunnel(world.client).connect()


async def test_plaintext_api_calls_are_refused_in_required_mode(world, monkeypatch):
    monkeypatch.setattr(get_settings(), "secure_transport", "required")
    r = await world.client.get("/api/sources", headers=world.h("alice"))
    assert r.status_code == 426 and r.headers["x-nf-err"] == "required"
    assert (await world.client.post("/api/auth/login", json={"email": "a@b.co", "password": "x"})).status_code == 426
    assert (await world.client.get("/api/health")).status_code == 200
    assert (await world.client.get("/api/health")).json()["secure_transport"] == "required"


async def test_login_and_authenticated_calls_through_the_tunnel(secure):
    w, t = secure
    status, _, body = await t.call("POST", "/api/auth/login", {"email": "alice@example.com", "password": PASSWORDS["alice"]})
    assert status == 200
    token = json.loads(body)["token"]
    status, headers, body = await t.call("GET", "/api/auth/me", token=token)
    assert status == 200 and json.loads(body)["name"] == "Alice Client" and headers["content-type"] == "application/json"
    status, _, body = await t.call("GET", "/api/admin/users", token=token)
    assert status == 403, "the real status code travels inside the encrypted envelope"
    status, _, _ = await t.call("GET", "/api/auth/me")
    assert status == 401


async def test_nothing_readable_crosses_the_wire(secure):
    w, t = secure
    await t.call("POST", "/api/auth/login", {"email": "alice@example.com", "password": PASSWORDS["alice"]})
    token = w.h("alice")["Authorization"].split()[1]
    await t.call("GET", "/api/auth/me", token=token)
    wire = b"".join(t.wire)
    for secret in (PASSWORDS["alice"].encode(), b"alice@example.com", b"Alice Client", token.encode(), b"/api/auth/me", b"Bearer", b"scrypt"):
        assert secret not in wire, secret


async def test_replay_tamper_clock_and_session_checks(secure):
    w, t = secure
    token = w.h("alice")["Authorization"].split()[1]
    blob, hdrs, _ = t.build("GET", "/api/auth/me", headers={"authorization": f"Bearer {token}"})
    assert (await t.send(blob, hdrs)).status_code == 200
    replay = await t.send(blob, hdrs)
    assert replay.status_code == 400 and replay.headers["x-nf-err"] == "replay"

    blob, hdrs, _ = t.build("GET", "/api/auth/me", headers={"authorization": f"Bearer {token}"})
    flipped = bytearray(blob)
    flipped[-3] ^= 1
    r = await t.send(bytes(flipped), hdrs)
    assert r.status_code == 400 and r.headers["x-nf-err"] == "decrypt"

    blob, hdrs, _ = t.build("GET", "/api/auth/me", headers={"authorization": f"Bearer {token}"})
    r = await t.send(blob, {**hdrs, "X-NF-Ts": str(int(hdrs["X-NF-Ts"]) + 1)})
    assert r.status_code == 400 and r.headers["x-nf-err"] == "decrypt", "the timestamp is authenticated"

    old = str(int((time.time() - 3600) * 1000))
    blob, hdrs, _ = t.build("GET", "/api/auth/me", headers={"authorization": f"Bearer {token}"}, ts=old)
    r = await t.send(blob, hdrs)
    assert r.status_code == 400 and r.headers["x-nf-err"] == "clock"

    r = await w.client.post("/api/secure/call", content=blob, headers={"X-NF-Sid": "nope", "X-NF-Ts": hdrs["X-NF-Ts"]})
    assert r.status_code == 401 and r.headers["x-nf-err"] == "session"

    other = await Tunnel(w.client).connect()
    blob, hdrs, _ = t.build("GET", "/api/auth/me", headers={"authorization": f"Bearer {token}"})
    r = await other.send(blob, {**hdrs, "X-NF-Sid": other.sid})
    assert r.status_code == 400, "a request sealed for one session is useless in another"


async def test_tunnel_cannot_be_aimed_outside_the_api(secure):
    w, t = secure
    for target in ("/openapi.json", "/api/../secret", "http://evil.example/api/x", "/api/secure/call", "//api/x", "api/sources"):
        blob, hdrs, _ = t.build("GET", target)
        r = await t.send(blob, hdrs)
        assert r.status_code == 400, target
    blob, hdrs, _ = t.build("TRACE", "/api/health")
    assert (await t.send(blob, hdrs)).status_code == 400


async def test_handshake_rejects_garbage_and_wrong_pinned_key(world):
    assert (await world.client.post("/api/secure/handshake", json={"client_pub": b64(b"\x04" + b"\x01" * 64)})).status_code == 400
    assert (await world.client.post("/api/secure/handshake", json={"client_pub": "AAAA"})).status_code == 400
    impostor = transport.public_point(ec.generate_private_key(ec.SECP256R1()))
    with pytest.raises(Exception):  # a man in the middle without the pinned key cannot produce a valid signature
        await Tunnel(world.client).connect(pinned_pub=impostor)


async def test_event_streams_are_encrypted_frame_by_frame(secure, monkeypatch):
    w, t = secure
    scripted_llm(monkeypatch, answer="streamed hello")
    token = w.h("alice")["Authorization"].split()[1]
    meta, text = await t.stream("/api/chat/stream", {"message": "hello there"}, token)
    assert meta["s"] == 200 and meta["h"]["content-type"].startswith("text/event-stream")
    events = [blk.split("\n")[0][7:] for blk in text.split("\n\n") if blk.startswith("event: ")]
    assert events[0] == "start" and events[-1] == "final" and "trace" in events
    assert b"streamed hello" not in b"".join(t.wire)


async def test_multipart_uploads_and_binary_downloads_work_through_the_tunnel(secure):
    w, t = secure
    token = w.h("alice")["Authorization"].split()[1]
    csv = b"fuel,speed\nPMMA,3.1\nethanol,2.2\n"
    req = httpx.Request("POST", "http://t/x", files=[("files", ("secret-notes.csv", csv, "text/csv"))])
    status, _, body = await t.call("POST", "/api/sources/upload?visibility=private", token=token, raw=req.read(), ctype=req.headers["content-type"])
    assert status == 200 and json.loads(body)["sources"][0]["filename"] == "secret-notes.csv"
    assert b"secret-notes" not in b"".join(t.wire) and b"PMMA" not in b"".join(t.wire)


async def test_unhandled_errors_come_back_encrypted(secure, monkeypatch):
    w, t = secure
    from app.routers import auth

    async def boom(*a, **k):
        raise RuntimeError("kaboom")

    monkeypatch.setattr(auth.users, "get_by_email", boom)
    status, _, body = await t.call("POST", "/api/auth/login", {"email": "alice@example.com", "password": "x" * 12})
    assert status == 500 and b"kaboom" not in body and b"Internal server error" in body


def test_frame_helpers_roundtrip():
    meta, body = transport.unpack(transport.pack({"s": 200}, b"payload"))
    assert meta == {"s": 200} and body == b"payload"
    with pytest.raises(ValueError):
        transport.unpack(struct.pack(">I", 999) + b"{}")
