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

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const body = await res.json();
      msg = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail ?? body);
    } catch {}
    throw new ApiError(msg, res.status);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

async function call(path: string, init: CallInit & { anonymous?: boolean } = {}): Promise<Response> {
  const { anonymous, ...rest } = init;
  let res: Response;
  try {
    res = await secureFetch(path, { ...rest, token: anonymous ? null : tokenOf() });
  } catch (e) {
    if (e instanceof TransportError) throw new ApiError(e.message, e.status);
    if (e instanceof TypeError) throw new ApiError(`Can't reach the API at ${API_URL}. Is the backend running?`, 0);
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
    if (!res.ok || !res.body) throw new ApiError((await res.text()) || res.statusText, res.status);
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
