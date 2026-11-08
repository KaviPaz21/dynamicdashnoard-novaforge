"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { api, ApiError, type StoredMessage } from "@/lib/api";
import type { ThemeName } from "@/lib/palette";
import type {
  ActiveFilter, ChatResponse, ChatSessionInfo, Citation, Dashboard, Health, KbScope, Layout, Relationship, SheetInfo,
  SourceDoc, TraceEvent, Widget,
} from "@/lib/types";
import { useToasts } from "./useToasts";

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  suggestions?: string[];
  intent?: string;
  trace?: TraceEvent[];
  blocked?: boolean;
  attachments?: string[];
  error?: boolean;
}

export type Tab = "dashboard" | "data" | "knowledge";
export type SaveState = "idle" | "saving" | "saved" | "error";

const THEME_KEY = "novaforge-theme";
const SESSION_KEY = "novaforge-session";

interface AppState {
  ownerId: string | null;
  tab: Tab;
  theme: ThemeName;
  sidebarCollapsed: boolean;
  chatOpen: boolean;
  chatExpanded: boolean;
  sessionsOpen: boolean;
  unread: boolean;
  setChatOpen: (open: boolean) => void;
  toggleChatExpanded: () => void;
  toggleSessions: () => void;
  setTheme: (t: ThemeName) => void;
  initTheme: () => void;
  toggleSidebar: () => void;
  adoptOwner: (userId: string) => void;
  reset: () => void;
  health: Health | null;
  sources: SourceDoc[];
  relationships: Relationship[];

  sheets: SheetInfo[];
  activeSheetId: string | null;
  dashboard: Dashboard;
  dirty: boolean;
  saveState: SaveState;
  savedAt: number | null;

  filters: ActiveFilter[];
  messages: Message[];
  conversationId: string | null;
  sessions: ChatSessionInfo[];
  kbScope: KbScope;
  busy: boolean;
  trace: TraceEvent[];
  expandedWidgetId: string | null;

  setTab: (t: Tab) => void;
  refreshSources: () => Promise<void>;
  refreshHealth: () => Promise<void>;
  upload: (files: File[], visibility?: "private" | "global") => Promise<{ rejected: { filename: string; error: string }[] }>;
  attach: (files: File[]) => Promise<{ rejected: { filename: string; error: string }[] }>;
  removeSource: (id: string) => Promise<void>;

  loadSheets: () => Promise<void>;
  openSheet: (id: string) => Promise<void>;
  createSheet: (name?: string, widgets?: Widget[]) => Promise<void>;
  renameSheet: (name: string) => void;
  deleteSheet: (id: string) => Promise<void>;
  saveNow: () => Promise<void>;

  send: (text: string) => Promise<void>;
  newConversation: () => void;
  setKbScope: (s: KbScope) => void;
  loadSessions: () => Promise<void>;
  openConversation: (id: string) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  exportConversation: () => Promise<void>;

  setFilter: (f: ActiveFilter) => void;
  toggleValue: (f: Omit<ActiveFilter, "op" | "value"> & { value: unknown }) => void;
  removeFilter: (origin: string | null | undefined, column: string) => void;
  clearFilters: () => void;

  removeWidget: (id: string) => void;
  clearWidgets: () => void;
  updateWidget: (id: string, patch: Partial<Widget>) => void;
  setLayouts: (items: { id: string; layout: Layout }[]) => void;
  expandWidget: (id: string | null) => void;
}

const uid = () => Math.random().toString(36).slice(2, 10);
const newConvId = () => crypto.randomUUID().replaceAll("-", "");
const EMPTY: Dashboard = { title: "", widgets: [] };
const AUTO_NAME = /^(sheet|untitled|dashboard)\s*\d*$/i;

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function applyResponse(dash: Dashboard, res: ChatResponse): Dashboard {
  let widgets = [...dash.widgets];
  if (res.dashboard_action === "replace") {
    widgets = res.widgets;
  } else if (res.dashboard_action === "append") {
    for (const w of res.widgets) {
      const idx = w.replaces ? widgets.findIndex((x) => x.id === w.replaces) : -1;
      if (idx >= 0) widgets[idx] = w;
      else widgets.push(w);
    }
  }
  if (res.remove_widget_ids.length) widgets = widgets.filter((w) => !res.remove_widget_ids.includes(w.id));
  return { ...dash, widgets };
}

const sameLayout = (a: Layout, b: Layout) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

const fromStored = (m: StoredMessage): Message => ({
  id: uid(), role: m.role, content: m.content, citations: m.citations, suggestions: m.suggestions, intent: m.intent,
  trace: m.trace, blocked: m.blocked, attachments: m.attachments,
});

/** Everything that belongs to one signed-in person and must never be shown to the next one. */
const PER_USER = {
  tab: "dashboard" as Tab,
  chatOpen: false,
  sessionsOpen: false,
  unread: false,
  health: null,
  sources: [] as SourceDoc[],
  relationships: [] as Relationship[],
  sheets: [] as SheetInfo[],
  activeSheetId: null as string | null,
  dashboard: EMPTY,
  dirty: false,
  saveState: "idle" as SaveState,
  savedAt: null as number | null,
  filters: [] as ActiveFilter[],
  messages: [] as Message[],
  conversationId: null as string | null,
  sessions: [] as ChatSessionInfo[],
  kbScope: "all" as KbScope,
  busy: false,
  trace: [] as TraceEvent[],
  expandedWidgetId: null as string | null,
};

export const useApp = create<AppState>()(
  persist(
    (set, get) => ({
      ...PER_USER,
      ownerId: null,
      theme: "light",
      sidebarCollapsed: false,
      chatExpanded: false,
      setChatOpen: (chatOpen) => set(chatOpen ? { chatOpen, unread: false } : { chatOpen }),
      toggleChatExpanded: () => set((s) => ({ chatExpanded: !s.chatExpanded })),
      toggleSessions: () => set((s) => ({ sessionsOpen: !s.sessionsOpen })),
      setTheme: (theme) => {
        try {
          document.documentElement.dataset.theme = theme;
          localStorage.setItem(THEME_KEY, theme);
        } catch {}
        set({ theme });
      },
      initTheme: () => {
        const t = document.documentElement.dataset.theme;
        if (t === "light" || t === "dark") set({ theme: t });
      },
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

      adoptOwner: (userId) => {
        if (get().ownerId !== userId) {
          get().reset(); // a different person used this browser last: start clean
          set({ ownerId: userId });
        }
      },
      reset: () => {
        try {
          localStorage.removeItem(SESSION_KEY);
        } catch {}
        set({ ...PER_USER, ownerId: null });
      },

      setTab: (tab) => set({ tab }),

      refreshHealth: async () => {
        try {
          set({ health: await api.system() });
        } catch {
          set({ health: null });
        }
      },

      refreshSources: async () => {
        try {
          const [sources, rel] = await Promise.all([api.sources(), api.relationships()]);
          set({ sources, relationships: rel.relationships });
        } catch {}
      },

      upload: async (files, visibility = "private") => {
        const res = await api.upload(files, { visibility });
        await get().refreshSources();
        return { rejected: res.rejected };
      },

      attach: async (files) => {
        const conversationId = get().conversationId ?? newConvId();
        set({ conversationId });
        const res = await api.upload(files, { conversationId });
        await get().refreshSources();
        return { rejected: res.rejected };
      },

      removeSource: async (id) => {
        try {
          await api.deleteSource(id);
        } catch (e) {
          useToasts.getState().push(`Could not delete: ${errText(e)}`, "error");
          await get().refreshSources();
          return;
        }
        set((s) => ({
          sources: s.sources.filter((x) => x.id !== id),
          filters: s.filters.filter((f) => f.source_id !== id),
          dirty: s.activeSheetId ? true : s.dirty,
          dashboard: {
            ...s.dashboard,
            widgets: s.dashboard.widgets.filter((w) => w.source_id !== id && w.query?.source_id !== id),
          },
        }));
        await get().refreshSources();
      },

      loadSheets: async () => {
        try {
          const sheets = await api.sheets();
          set({ sheets });
          const { activeSheetId } = get();
          const target = sheets.find((s) => s.id === activeSheetId) ?? sheets[0];
          if (target) await get().openSheet(target.id);
          else set({ activeSheetId: null, dashboard: EMPTY });
        } catch {}
      },

      openSheet: async (id) => {
        if (get().dirty) await get().saveNow();
        try {
          const sheet = await api.sheet(id);
          set({
            activeSheetId: sheet.id,
            dashboard: { title: sheet.name, widgets: sheet.widgets },
            filters: sheet.filters ?? [],
            dirty: false,
            saveState: "idle",
            expandedWidgetId: null,
            tab: "dashboard",
          });
        } catch {
          await get().loadSheets();
        }
      },

      createSheet: async (name, widgets = []) => {
        if (get().dirty) await get().saveNow();
        const label = name?.trim() || `Sheet ${get().sheets.length + 1}`;
        const sheet = await api.createSheet(label, widgets, []);
        set((s) => ({
          sheets: [...s.sheets, { id: sheet.id, name: sheet.name, widget_count: widgets.length, updated_at: sheet.updated_at }],
          activeSheetId: sheet.id,
          dashboard: { title: sheet.name, widgets },
          filters: [],
          dirty: false,
          saveState: "saved",
          savedAt: Date.now(),
          expandedWidgetId: null,
          tab: "dashboard",
        }));
      },

      renameSheet: (name) => {
        const clean = name.trim();
        if (!clean || !get().activeSheetId) return;
        set((s) => ({
          dashboard: { ...s.dashboard, title: clean },
          sheets: s.sheets.map((x) => (x.id === s.activeSheetId ? { ...x, name: clean } : x)),
          dirty: true,
        }));
      },

      deleteSheet: async (id) => {
        try {
          await api.deleteSheet(id);
        } catch (e) {
          useToasts.getState().push(`Could not delete the sheet: ${errText(e)}`, "error");
          return;
        }
        const rest = get().sheets.filter((s) => s.id !== id);
        set({ sheets: rest });
        if (get().activeSheetId === id) {
          set({ dirty: false });
          if (rest[0]) await get().openSheet(rest[0].id);
          else set({ activeSheetId: null, dashboard: EMPTY, filters: [], saveState: "idle" });
        }
      },

      saveNow: async () => {
        const { activeSheetId, dashboard, filters } = get();
        if (!activeSheetId) return;
        set({ saveState: "saving", dirty: false });
        try {
          const saved = await api.saveSheet(activeSheetId, dashboard.title || "Sheet", dashboard.widgets, filters);
          set((s) => ({
            saveState: s.dirty ? s.saveState : "saved",
            savedAt: Date.now(),
            sheets: s.sheets.map((x) =>
              x.id === activeSheetId
                ? { ...x, name: dashboard.title, widget_count: dashboard.widgets.length, updated_at: saved.updated_at }
                : x,
            ),
          }));
        } catch {
          set({ saveState: "error", dirty: true });
        }
      },

      newConversation: () => set({ messages: [], conversationId: newConvId(), trace: [] }),
      setKbScope: (kbScope) => set({ kbScope }),

      loadSessions: async () => {
        try {
          set({ sessions: await api.conversations() });
        } catch {}
      },

      openConversation: async (id) => {
        if (get().busy) return;
        try {
          const conv = await api.conversation(id);
          set({ conversationId: conv.id, messages: conv.messages.map(fromStored), trace: [] });
        } catch (e) {
          if (e instanceof ApiError && e.status === 404) {
            // not saved yet (a chat that only has attachments so far) or deleted elsewhere: keep the id, show it empty
            set((s) => ({ sessions: s.sessions.filter((x) => x.id !== id), messages: s.conversationId === id ? [] : s.messages }));
          } else useToasts.getState().push(`Could not open the chat: ${errText(e)}`, "error");
        }
      },

      deleteConversation: async (id) => {
        try {
          await api.deleteConversation(id);
        } catch (e) {
          if (!(e instanceof ApiError && e.status === 404)) {
            useToasts.getState().push(`Could not delete the chat: ${errText(e)}`, "error");
            return;
          }
        }
        set((s) => ({ sessions: s.sessions.filter((x) => x.id !== id) }));
        if (get().conversationId === id) get().newConversation();
      },

      exportConversation: async () => {
        const { conversationId, messages } = get();
        if (!conversationId || !messages.length) return;
        try {
          const { blob, filename } = await api.exportConversation(conversationId);
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = filename;
          document.body.append(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 10_000);
        } catch (e) {
          useToasts.getState().push(`Export failed: ${errText(e)}`, "error");
        }
      },

      send: async (text) => {
        const state = get();
        if (!text.trim() || state.busy) return;
        const conversationId = state.conversationId ?? newConvId();
        const attachments = state.sources.filter((s) => s.conversation_id === conversationId && s.status === "ready");
        const userMsg: Message = {
          id: uid(), role: "user", content: text.trim(), attachments: attachments.map((s) => s.name || s.filename),
        };
        set({ messages: [...state.messages, userMsg], conversationId, busy: true, trace: [], chatOpen: true, unread: false });
        const trace: TraceEvent[] = [];
        try {
          let final: ChatResponse | null = null;
          let failure: string | null = null;
          await api.chatStream(
            {
              message: userMsg.content,
              conversation_id: conversationId,
              dashboard: { title: state.dashboard.title, widgets: state.dashboard.widgets.map((w) => ({ ...w, data: undefined, trend_data: undefined })) },
              filters: state.filters,
              kb_scope: state.kbScope,
              attachment_ids: attachments.map((s) => s.id),
            },
            (e) => {
              if (e.event === "trace") {
                trace.push(e.data);
                set({ trace: [...trace] });
              } else if (e.event === "title") {
                const t = e.data;
                set((s) => ({
                  sessions: s.sessions.some((x) => x.id === t.id)
                    ? s.sessions.map((x) => (x.id === t.id ? { ...x, title: t.title } : x))
                    : [{ id: t.id, title: t.title, updated_at: new Date().toISOString(), messages: 0 }, ...s.sessions],
                }));
              } else if (e.event === "final") final = e.data;
              else if (e.event === "error") failure = e.data.message;
            },
          );
          if (failure || !final) throw new Error(failure ?? "No response from the agent");
          const res: ChatResponse = final;

          const cur = get();
          const changes = res.widgets.length > 0 || res.remove_widget_ids.length > 0;
          if (changes) {
            const name = res.dashboard_title || undefined;
            if (res.dashboard_action === "replace" && res.widgets.length && cur.dashboard.widgets.length) {
              await get().createSheet(name, res.widgets);
            } else {
              if (!get().activeSheetId) await get().createSheet(name, []);
              set((s) => {
                const renamed =
                  res.dashboard_action === "replace" && name && AUTO_NAME.test(s.dashboard.title) ? name : s.dashboard.title;
                return {
                  dashboard: { ...applyResponse(s.dashboard, res), title: renamed },
                  sheets: s.sheets.map((x) => (x.id === s.activeSheetId ? { ...x, name: renamed } : x)),
                  dirty: true,
                };
              });
            }
          }
          set((s) => ({
            conversationId: res.conversation_id,
            filters: res.dashboard_action === "replace" ? [] : s.filters,
            messages: [
              ...s.messages,
              {
                id: uid(), role: "assistant", content: res.message, citations: res.citations, suggestions: res.suggestions,
                intent: res.intent, trace: res.trace?.length ? res.trace : trace, blocked: res.blocked,
              },
            ],
            sessions: [
              {
                id: res.conversation_id,
                title: res.title || s.sessions.find((x) => x.id === res.conversation_id)?.title || "New chat",
                updated_at: new Date().toISOString(),
                messages: s.messages.length + 1,
              },
              ...s.sessions.filter((x) => x.id !== res.conversation_id),
            ],
            tab: res.widgets.length ? "dashboard" : s.tab,
            unread: !s.chatOpen,
          }));
        } catch (e) {
          set((s) => ({
            messages: [...s.messages, { id: uid(), role: "assistant", content: errText(e), error: true }],
          }));
        } finally {
          set({ busy: false, trace: [] });
        }
      },

      setFilter: (f) =>
        set((s) => ({
          filters: [
            ...s.filters.filter((x) => !(x.origin_widget_id === f.origin_widget_id && x.column === f.column)),
            f,
          ],
          dirty: s.activeSheetId ? true : s.dirty,
        })),

      toggleValue: (f) =>
        set((s) => {
          const existing = s.filters.find((x) => x.origin_widget_id === f.origin_widget_id && x.column === f.column);
          const others = s.filters.filter((x) => x !== existing);
          const current = new Set<unknown>(existing && Array.isArray(existing.value) ? existing.value : []);
          if (current.has(f.value)) current.delete(f.value);
          else current.add(f.value);
          const dirty = s.activeSheetId ? true : s.dirty;
          if (!current.size) return { filters: others, dirty };
          return {
            filters: [
              ...others,
              { source_id: f.source_id, column: f.column, origin_widget_id: f.origin_widget_id, op: "in", value: [...current] },
            ],
            dirty,
          };
        }),

      removeFilter: (origin, column) =>
        set((s) => ({
          filters: s.filters.filter((x) => !(x.origin_widget_id === origin && x.column === column)),
          dirty: s.activeSheetId ? true : s.dirty,
        })),
      clearFilters: () => set((s) => ({ filters: [], dirty: s.activeSheetId ? true : s.dirty })),

      removeWidget: (id) =>
        set((s) => ({
          dashboard: { ...s.dashboard, widgets: s.dashboard.widgets.filter((w) => w.id !== id) },
          filters: s.filters.filter((f) => f.origin_widget_id !== id),
          expandedWidgetId: s.expandedWidgetId === id ? null : s.expandedWidgetId,
          dirty: true,
        })),
      clearWidgets: () =>
        set((s) => ({ dashboard: { ...s.dashboard, widgets: [] }, filters: [], dirty: s.activeSheetId ? true : s.dirty })),
      updateWidget: (id, patch) =>
        set((s) => ({
          dashboard: {
            ...s.dashboard,
            widgets: s.dashboard.widgets.map((w) => (w.id === id ? { ...w, ...patch } : w)),
          },
          dirty: true,
        })),
      setLayouts: (items) =>
        set((s) => {
          const byId = new Map(items.map((i) => [i.id, i.layout]));
          let changed = false;
          const widgets = s.dashboard.widgets.map((w) => {
            const next = byId.get(w.id);
            if (!next || sameLayout(w.layout, next)) return w;
            changed = true;
            return { ...w, layout: next };
          });
          return changed ? { dashboard: { ...s.dashboard, widgets }, dirty: true } : {};
        }),
      expandWidget: (id) => set({ expandedWidgetId: id }),
    }),
    {
      name: SESSION_KEY,
      version: 3,
      storage: createJSONStorage(() => ({
        getItem: (k) => {
          try { return localStorage.getItem(k); } catch { return null; }
        },
        setItem: (k, v) => {
          try { localStorage.setItem(k, v); } catch {}
        },
        removeItem: (k) => {
          try { localStorage.removeItem(k); } catch {}
        },
      })),
      skipHydration: true,
      // only UI preferences and ids: chats and sheets are always loaded from the server for the signed-in user
      partialize: (s) => ({
        ownerId: s.ownerId,
        sidebarCollapsed: s.sidebarCollapsed,
        chatOpen: s.chatOpen,
        chatExpanded: s.chatExpanded,
        sessionsOpen: s.sessionsOpen,
        activeSheetId: s.activeSheetId,
        conversationId: s.conversationId,
        kbScope: s.kbScope,
      }),
    },
  ),
);
