import { API_URL, secureFetch, TransportError, type CallInit } from "./secure";
import type {
  ActiveFilter, AuthSession, ChatRequest, ChatSessionInfo, Citation, Flag, FlaggedUser, Health, KbScope,
  QueryResult, QuerySpec, Relationship, Role, Row, Sheet, SheetInfo, SourceDoc, StreamEvent, TraceEvent, User, UserDetail,
  Widget,
} from "./types";

export { API_URL };

export type GeoKind = "us_state" | "country" | "city";
export interface GeoMatch {
  id?: string;
  lat?: number;
  lon?: number;
  label: string;
}

export const stripWidgets = (widgets: Widget[]): Widget[] =>
  widgets.map((w) => ({ ...w, data: null, trend_data: null, error: null }));

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

let tokenOf: () => string | null = () => null;
let authLost: () => void = () => {};

/** The auth store registers itself here so every call carries the bearer token and a 401 signs the user out. */
export function bindAuth(getToken: () => string | null, onLost: () => void) {
  tokenOf = getToken;
  authLost = onLost;
}

const GENERIC: Record<number, string> = {
  0: "Can't connect right now. Please check your connection and try again.",
  401: "Your session has ended. Please sign in again.",
  403: "You don't have permission to do that.",
  404: "That could not be found.",
  413: "That file is too large.",
  429: "Too many attempts. Please wait a moment and try again.",
};
const SOMETHING = "Something went wrong. Please try again.";

// Anything that looks like a stack trace, URL, setting name or model/database detail is never shown to people
const TECHNICAL = /https?:\/\/|localhost|127\.0\.0\.1|traceback|exception|\w+Error|\.(py|ts|js|env)|[A-Z][A-Z0-9]*_[A-Z0-9_]{2,}|cosmos|gpt-|openai|azure|\{|\}/i;

/** The text a person may see for a failed call: the API's own wording only when it is short, plain and a client error. */
export function userMessage(status: number, detail?: string | null, fallback = SOMETHING): string {
  if (status >= 500) return SOMETHING;
  const d = (detail ?? "").trim();
  if (status >= 400 && d && d.length <= 140 && !TECHNICAL.test(d)) return d;
  return GENERIC[status] ?? (status === 0 ? GENERIC[0] : fallback);
}

/** Safe text for any caught error. Unknown errors (network failures, bugs) become a generic sentence. */
export function errorText(e: unknown, fallback = SOMETHING): string {
  return e instanceof ApiError ? e.message : fallback;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail: string | undefined;
    try {
      const body = await res.json();
      detail = typeof body.detail === "string" ? body.detail : undefined;
    } catch {}
    throw new ApiError(userMessage(res.status, detail), res.status);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

function transportText(e: TransportError): string {
  if (e.code === "identity") return "We couldn't verify a secure connection to the server, so nothing was sent.";
  if (e.code === "no-crypto") return "This browser can't open a secure connection here. Use a secure (https) address.";
  if (["session", "clock", "decrypt", "replay", "stream"].includes(e.code)) return "The secure connection was interrupted. Please try again.";
  return userMessage(e.status, undefined);
}

async function call(path: string, init: CallInit & { anonymous?: boolean } = {}): Promise<Response> {
  const { anonymous, ...rest } = init;
  let res: Response;
  try {
    res = await secureFetch(path, { ...rest, token: anonymous ? null : tokenOf() });
  } catch (e) {
    if (e instanceof TransportError) throw new ApiError(transportText(e), e.status || 0);
    if (e instanceof TypeError) throw new ApiError(GENERIC[0], 0); // fetch failed: nothing about where
    throw e;
  }
  if (res.status === 401 && !anonymous) authLost();
  return res;
}

const get = <T>(path: string) => call(path).then(json<T>);
const send = <T>(method: string, path: string, body?: unknown, anonymous = false) =>
  call(path, { method, json: body, anonymous }).then(json<T>);

export interface UploadOptions {
  visibility?: "private" | "global";
  conversationId?: string | null;
}

export const api = {
  health: () => fetch(`${API_URL}/health`, { cache: "no-store" }).then(json<{ status: string; secure_transport: string }>),
  system: () => get<Health>("/system"),

  login: (email: string, password: string) => send<AuthSession>("POST", "/auth/login", { email, password }, true),
  me: () => get<User>("/auth/me"),
  refresh: () => send<AuthSession>("POST", "/auth/refresh"),
  logout: () => call("/auth/logout", { method: "POST" }).then(() => undefined),
  changePassword: (current_password: string, new_password: string) =>
    send<AuthSession>("POST", "/auth/change-password", { current_password, new_password }),

  sources: (scope: "all" | "mine" | "global" = "all") => get<SourceDoc[]>(`/sources?scope=${scope}`),
  preview: (id: string, limit = 50) => get<{ columns: string[]; rows: Row[] }>(`/sources/${id}/preview?limit=${limit}`),
  deleteSource: (id: string) => send<void>("DELETE", `/sources/${id}`),
  relationships: () => get<{ relationships: Relationship[] }>("/semantic-model"),
  saveRelationships: (relationships: Relationship[]) =>
    send<{ relationships: Relationship[] }>("PUT", "/semantic-model", { relationships }),

  geoResolve: (kind: GeoKind, items: { name: string; hint?: string | null }[]) =>
    send<{ results: (GeoMatch | null)[] }>("POST", "/geo/resolve", { kind, items }),
  sheets: () => get<SheetInfo[]>("/dashboards"),
  sheet: (id: string) => get<Sheet>(`/dashboards/${id}`),
  createSheet: (name: string, widgets: Widget[], filters: ActiveFilter[]) =>
    send<Sheet>("POST", "/dashboards", { name, widgets: stripWidgets(widgets), filters }),
  saveSheet: (id: string, name: string, widgets: Widget[], filters: ActiveFilter[]) =>
    send<Sheet>("PUT", `/dashboards/${id}`, { name, widgets: stripWidgets(widgets), filters }),
  deleteSheet: (id: string) => send<void>("DELETE", `/dashboards/${id}`),

  upload: (files: File[], opts: UploadOptions = {}) => {
    const form = new FormData();
    files.forEach((f) => form.append("files", f));
    const q = new URLSearchParams({ visibility: opts.visibility ?? "private" });
    if (opts.conversationId) q.set("conversation_id", opts.conversationId);
    return call(`/sources/upload?${q}`, { method: "POST", form }).then(
      json<{ sources: SourceDoc[]; rejected: { filename: string; error: string }[] }>,
    );
  },

  query: (spec: QuerySpec, slicers: ActiveFilter[], excludeOrigin?: string, signal?: AbortSignal) =>
    call("/query", { json: { spec, slicers, exclude_origin: excludeOrigin ?? null }, signal }).then(json<QueryResult>),

  conversations: () => get<ChatSessionInfo[]>("/conversations"),
  conversation: (id: string) =>
    get<{ id: string; title: string; messages: StoredMessage[] }>(`/conversations/${id}`),
  deleteConversation: (id: string) => send<void>("DELETE", `/conversations/${id}`),
  exportConversation: async (id: string) => {
    const res = await call(`/conversations/${id}/export`);
    if (!res.ok) await json(res);
    const cd = res.headers.get("content-disposition") ?? "";
    return { blob: await res.blob(), filename: /filename="([^"]+)"/.exec(cd)?.[1] ?? "NovaForge-conversation.pdf" };
  },

  async chatStream(req: ChatRequest, onEvent: (e: StreamEvent) => void, signal?: AbortSignal) {
    const res = await call("/chat/stream", { json: req, signal });
    if (!res.ok || !res.body) throw new ApiError(userMessage(res.status), res.status);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        let event = "message";
        let data = "";
        for (const line of block.split("\n")) {
          if (line.startsWith("event: ")) event = line.slice(7);
          else if (line.startsWith("data: ")) data += line.slice(6);
        }
        if (data) onEvent({ event, data: JSON.parse(data) } as StreamEvent);
      }
    }
  },

  admin: {
    users: () => get<User[]>("/admin/users"),
    createUser: (name: string, email: string, role: Role) =>
      send<{ user: User; temp_password: string }>("POST", "/admin/users", { name, email, role }),
    user: (id: string) => get<UserDetail>(`/admin/users/${id}`),
    patchUser: (id: string, patch: { name?: string; role?: Role; active?: boolean }) =>
      send<UserDetail>("PATCH", `/admin/users/${id}`, patch),
    resetPassword: (id: string) => send<{ temp_password: string }>("POST", `/admin/users/${id}/reset-password`),
    deleteUser: (id: string) => send<void>("DELETE", `/admin/users/${id}`),
    flagSummary: () => get<{ unreviewed: number }>("/admin/flags/summary"),
    flaggedUsers: () => get<FlaggedUser[]>("/admin/flags/users"),
    flags: (userId: string) => get<Flag[]>(`/admin/flags?user_id=${encodeURIComponent(userId)}`),
    reviewFlag: (id: string, reviewed: boolean) => send<Flag>("PATCH", `/admin/flags/${id}`, { reviewed }),
  },
};

export interface StoredMessage {
  role: "user" | "assistant";
  content: string;
  ts?: string;
  intent?: string;
  citations?: Citation[];
  suggestions?: string[];
  trace?: TraceEvent[];
  blocked?: boolean;
  attachments?: string[];
  kb_scope?: KbScope;
}
