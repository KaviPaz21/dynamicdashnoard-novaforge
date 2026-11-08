/**
 * Encrypted transport to the API (see BE/app/security/transport.py for the full protocol).
 *
 * Handshake: ephemeral ECDH P-256 -> HKDF-SHA256 -> two AES-256-GCM keys (one per direction). The server's reply is signed with
 * a long-term ECDSA key whose public half is pinned in this build (NEXT_PUBLIC_SECURE_SIGNING_PUBKEY), so a man in the middle
 * cannot swap in its own key. Every API call is then sealed and sent through POST /secure/call: the method, path, bearer token
 * and body are inside the ciphertext. Replies (and event-stream frames) come back sealed the same way.
 */

const PINNED = process.env.NEXT_PUBLIC_SECURE_SIGNING_PUBKEY ?? "";
const enc = new TextEncoder();
const dec = new TextDecoder();

export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api").replace(/\/$/, "");
const API_PREFIX = (() => {
  try {
    return new URL(API_URL).pathname.replace(/\/$/, "");
  } catch {
    return "/api";
  }
})();

type Bytes = Uint8Array<ArrayBuffer>;
const bs = (u: Uint8Array): BufferSource => u as unknown as BufferSource;

const b64e = (u: Uint8Array) => {
  let s = "";
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
};
const b64d = (s: string): Bytes => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const hex = (u: Uint8Array) => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");
const u32 = (n: number): Bytes => {
  const a = new Uint8Array(4);
  new DataView(a.buffer).setUint32(0, n);
  return a;
};
function concat(...parts: Uint8Array[]): Bytes {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export class TransportError extends Error {
  constructor(
    message: string,
    public code: string,
    public status = 0,
  ) {
    super(message);
  }
}

interface Session {
  sid: string;
  c2s: CryptoKey;
  s2c: CryptoKey;
  skewMs: number;
  expiresAt: number;
}

let session: Session | null = null;
let connecting: Promise<Session> | null = null;
let mode: "required" | "optional" | "off" | null = null;
let warned = false;

export function resetTransport() {
  session = null;
  connecting = null;
}

export async function transportMode(): Promise<"required" | "optional" | "off"> {
  if (mode) return mode;
  try {
    const r = await fetch(`${API_URL}/health`, { cache: "no-store" });
    mode = ((await r.json()).secure_transport ?? "required") as "required" | "optional" | "off";
  } catch {
    return "required"; // unreachable API: assume the strict mode, don't cache
  }
  return mode;
}

async function handshake(): Promise<Session> {
  if (!globalThis.crypto?.subtle)
    throw new TransportError(
      "This browser context has no WebCrypto (open the app over https:// or http://localhost).", "no-crypto",
    );
  const kp = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  const mine = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
  const res = await fetch(`${API_URL}/secure/handshake`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_pub: b64e(mine) }),
  });
  if (!res.ok) throw new TransportError("Secure handshake failed", "handshake", res.status);
  const j = await res.json();
  const serverPub = b64d(j.server_pub);
  const salt = b64d(j.salt);

  if (PINNED) {
    const verifier = await crypto.subtle.importKey("raw", bs(b64d(PINNED)), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    const ok = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" }, verifier, bs(b64d(j.sig)), bs(concat(mine, serverPub, salt, enc.encode(j.sid))),
    );
    if (!ok) throw new TransportError("The server's identity could not be verified. Do not continue.", "identity");
  } else if (!warned) {
    warned = true;
    console.warn("NEXT_PUBLIC_SECURE_SIGNING_PUBKEY is not set: the server's identity is not being verified.");
  }

  const peer = await crypto.subtle.importKey("raw", bs(serverPub), { name: "ECDH", namedCurve: "P-256" }, false, []);
  const secret = await crypto.subtle.deriveBits({ name: "ECDH", public: peer }, kp.privateKey, 256);
  const hkdf = await crypto.subtle.importKey("raw", secret, "HKDF", false, ["deriveBits"]);
  const okm = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "HKDF", hash: "SHA-256", salt: bs(salt), info: bs(enc.encode(`novaforge-transport-v1|${j.sid}`)) }, hkdf, 512,
    ),
  );
  return {
    sid: j.sid,
    c2s: await crypto.subtle.importKey("raw", bs(okm.slice(0, 32)), "AES-GCM", false, ["encrypt"]),
    s2c: await crypto.subtle.importKey("raw", bs(okm.slice(32)), "AES-GCM", false, ["decrypt"]),
    skewMs: j.server_time - Date.now(),
    expiresAt: Date.now() + j.expires_in * 1000 - 60_000,
  };
}

async function ensureSession(): Promise<Session> {
  if (session && session.expiresAt > Date.now()) return session;
  connecting ??= handshake()
    .then((s) => (session = s))
    .finally(() => (connecting = null));
  return connecting;
}

function pack(meta: object, body: Uint8Array): Bytes {
  const m = enc.encode(JSON.stringify(meta));
  return concat(u32(m.length), m, body);
}
function unpack(blob: Uint8Array): { meta: { s: number; h: Record<string, string> }; body: Bytes } {
  const n = new DataView(blob.buffer, blob.byteOffset, blob.byteLength).getUint32(0);
  return { meta: JSON.parse(dec.decode(blob.subarray(4, 4 + n))), body: blob.slice(4 + n) as Bytes };
}

async function open(key: CryptoKey, blob: Uint8Array, aad: Uint8Array): Promise<Bytes> {
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: bs(blob.subarray(0, 12)), additionalData: bs(aad), tagLength: 128 }, key, bs(blob.subarray(12)),
  );
  return new Uint8Array(plain);
}

const NULL_BODY = new Set([204, 205, 304]);

/** Send one API call through the encrypted tunnel; resolves to an ordinary Response (status, headers and body decrypted). */
async function sealedFetch(
  method: string, path: string, body: Uint8Array, headers: Record<string, string>, signal?: AbortSignal, retried = false,
): Promise<Response> {
  const s = await ensureSession();
  const ts = String(Date.now() + s.skewMs);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: bs(nonce), additionalData: bs(enc.encode(`nf1|req|${s.sid}|${ts}`)), tagLength: 128 },
      s.c2s, bs(pack({ m: method, p: `${API_PREFIX}${path}`, h: headers }, body)),
    ),
  );
  const res = await fetch(`${API_URL}/secure/call`, {
    method: "POST",
    headers: { "X-NF-Sid": s.sid, "X-NF-Ts": ts, "Content-Type": "application/octet-stream" },
    body: bs(concat(nonce, sealed)),
    signal,
    cache: "no-store",
  });

  const kind = res.headers.get("x-nf-enc");
  if (!kind) {
    const code = res.headers.get("x-nf-err") ?? "";
    if (!retried && (code === "session" || code === "clock")) {
      resetTransport(); // server restarted / session expired / clock drifted: re-handshake once
      return sealedFetch(method, path, body, headers, signal, true);
    }
    let detail = res.statusText;
    try {
      detail = (await res.json()).detail ?? detail;
    } catch {}
    throw new TransportError(detail, code || "transport", res.status);
  }

  const nonceHex = hex(nonce);
  if (kind === "1") {
    const { meta, body: inner } = unpack(await open(s.s2c, new Uint8Array(await res.arrayBuffer()), enc.encode(`nf1|res|${s.sid}|${nonceHex}`)));
    return new Response(NULL_BODY.has(meta.s) ? null : bs(inner), { status: meta.s, headers: meta.h });
  }

  // event stream: one sealed frame per `data:` line, the first carries the status and headers
  const reader = res.body!.getReader();
  let buf = "";
  let seq = 0;
  const next = async (): Promise<Bytes | null> => {
    for (;;) {
      const cut = buf.indexOf("\n\n");
      if (cut >= 0) {
        const line = buf.slice(0, cut);
        buf = buf.slice(cut + 2);
        if (line.startsWith("data: ")) {
          const aad = concat(enc.encode(`nf1|str|${s.sid}|${nonceHex}|`), u32(seq++));
          return open(s.s2c, b64d(line.slice(6)), aad);
        }
        continue;
      }
      const { value, done } = await reader.read();
      if (done) return null;
      buf += dec.decode(value, { stream: true });
    }
  };
  const first = await next();
  if (!first) throw new TransportError("Empty secure stream", "stream");
  const { meta } = unpack(first);
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await next();
        if (chunk) controller.enqueue(chunk);
        else controller.close();
      } catch (e) {
        controller.error(e);
      }
    },
    cancel: () => reader.cancel(),
  });
  return new Response(stream, { status: meta.s, headers: meta.h });
}

export interface CallInit {
  method?: string;
  json?: unknown;
  form?: FormData;
  token?: string | null;
  signal?: AbortSignal;
}

/** Fetch an API path (e.g. "/sources"), encrypted unless the server runs with SECURE_TRANSPORT=off. */
export async function secureFetch(path: string, init: CallInit = {}): Promise<Response> {
  const method = init.method ?? (init.json !== undefined || init.form ? "POST" : "GET");
  const headers: Record<string, string> = {};
  let body: Uint8Array = new Uint8Array(0);
  if (init.json !== undefined) {
    headers["content-type"] = "application/json";
    body = enc.encode(JSON.stringify(init.json));
  } else if (init.form) {
    const packed = new Response(init.form); // lets the browser build the multipart body and its boundary
    headers["content-type"] = packed.headers.get("content-type") ?? "multipart/form-data";
    body = new Uint8Array(await packed.arrayBuffer());
  }
  if (init.token) headers.authorization = `Bearer ${init.token}`;

  if ((await transportMode()) === "off") {
    const plain: Record<string, string> = { ...headers };
    if (init.form) delete plain["content-type"];
    return fetch(`${API_URL}${path}`, {
      method, headers: plain, signal: init.signal, cache: "no-store",
      body: init.json !== undefined ? JSON.stringify(init.json) : init.form,
    });
  }
  return sealedFetch(method, path, body, headers, init.signal);
}
