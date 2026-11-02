import type {
  ChatRequest, Health, QueryResult, QuerySpec, ActiveFilter, Relationship, Row, Sheet, SheetInfo, SourceDoc,
  StreamEvent, Widget,
} from "./types";

export type GeoKind = "us_state" | "country" | "city";
export interface GeoMatch {
  id?: string;
  lat?: number;
  lon?: number;
  label: string;
}

export const stripWidgets = (widgets: Widget[]): Widget[] =>
  widgets.map((w) => ({ ...w, data: null, trend_data: null, error: null }));

export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api").replace(/\/$/, "");

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
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

const post = (path: string, body: unknown, signal?: AbortSignal) =>
  fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

export const api = {
  health: () => fetch(`${API_URL}/health`).then(json<Health>),
  sources: () => fetch(`${API_URL}/sources`, { cache: "no-store" }).then(json<SourceDoc[]>),
  preview: (id: string, limit = 50) =>
    fetch(`${API_URL}/sources/${id}/preview?limit=${limit}`).then(json<{ columns: string[]; rows: Row[] }>),
  deleteSource: (id: string) => fetch(`${API_URL}/sources/${id}`, { method: "DELETE" }).then(json<void>),
  relationships: () =>
    fetch(`${API_URL}/semantic-model`, { cache: "no-store" }).then(json<{ relationships: Relationship[] }>),
  saveRelationships: (relationships: Relationship[]) =>
    fetch(`${API_URL}/semantic-model`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ relationships }),
    }).then(json<{ relationships: Relationship[] }>),

  geoResolve: (kind: GeoKind, items: { name: string; hint?: string | null }[]) =>
    post("/geo/resolve", { kind, items }).then(json<{ results: (GeoMatch | null)[] }>),
  sheets: () => fetch(`${API_URL}/dashboards`, { cache: "no-store" }).then(json<SheetInfo[]>),
  sheet: (id: string) => fetch(`${API_URL}/dashboards/${id}`, { cache: "no-store" }).then(json<Sheet>),
  createSheet: (name: string, widgets: Widget[], filters: ActiveFilter[]) =>
    post("/dashboards", { name, widgets: stripWidgets(widgets), filters }).then(json<Sheet>),
  saveSheet: (id: string, name: string, widgets: Widget[], filters: ActiveFilter[]) =>
    fetch(`${API_URL}/dashboards/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, widgets: stripWidgets(widgets), filters }),
    }).then(json<Sheet>),
  deleteSheet: (id: string) => fetch(`${API_URL}/dashboards/${id}`, { method: "DELETE" }).then(json<void>),

  upload: (files: File[]) => {
    const form = new FormData();
    files.forEach((f) => form.append("files", f));
    return fetch(`${API_URL}/sources/upload`, { method: "POST", body: form }).then(
      json<{ sources: SourceDoc[]; rejected: { filename: string; error: string }[] }>,
    );
  },

  query: (spec: QuerySpec, slicers: ActiveFilter[], excludeOrigin?: string, signal?: AbortSignal) =>
    post("/query", { spec, slicers, exclude_origin: excludeOrigin ?? null }, signal).then(json<QueryResult>),

  async chatStream(req: ChatRequest, onEvent: (e: StreamEvent) => void, signal?: AbortSignal) {
    const res = await post("/chat/stream", req, signal);
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
};
