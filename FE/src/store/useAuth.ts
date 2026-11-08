"use client";

import { create } from "zustand";
import { api, ApiError, bindAuth } from "@/lib/api";
import { resetTransport } from "@/lib/secure";
import type { AuthSession, User } from "@/lib/types";
import { useApp } from "./useApp";

const KEY = "novaforge-auth";

type Status = "loading" | "anon" | "authed";

interface AuthState {
  status: Status;
  user: User | null;
  token: string | null;
  expiresAt: string | null;
  notice: string | null;
  init: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  setSession: (s: AuthSession) => void;
  changePassword: (current: string, next: string) => Promise<void>;
  logout: (notice?: string) => Promise<void>;
  renewIfNeeded: () => Promise<void>;
}

// sessionStorage: the token survives a reload but not a closed tab
const store = {
  read: (): { token: string; expiresAt: string } | null => {
    try {
      return JSON.parse(sessionStorage.getItem(KEY) ?? "null");
    } catch {
      return null;
    }
  },
  write: (token: string, expiresAt: string) => {
    try {
      sessionStorage.setItem(KEY, JSON.stringify({ token, expiresAt }));
    } catch {}
  },
  clear: () => {
    try {
      sessionStorage.removeItem(KEY);
    } catch {}
  },
};

export const useAuth = create<AuthState>()((set, get) => ({
  status: "loading",
  user: null,
  token: null,
  expiresAt: null,
  notice: null,

  init: async () => {
    const saved = store.read();
    if (!saved || new Date(saved.expiresAt).getTime() <= Date.now()) {
      store.clear();
      set({ status: "anon" });
      return;
    }
    set({ token: saved.token, expiresAt: saved.expiresAt });
    try {
      set({ user: await api.me(), status: "authed" });
    } catch (e) {
      store.clear();
      set({
        token: null, expiresAt: null, user: null, status: "anon",
        notice: e instanceof ApiError && e.status === 0 ? "Can't reach the server. Is the API running?" : null,
      });
    }
  },

  setSession: (s) => {
    store.write(s.token, s.expires_at);
    set({ token: s.token, expiresAt: s.expires_at, user: s.user, status: "authed", notice: null });
  },

  login: async (email, password) => {
    get().setSession(await api.login(email, password));
  },

  changePassword: async (current, next) => {
    get().setSession(await api.changePassword(current, next));
  },

  logout: async (notice) => {
    const token = get().token;
    store.clear(); // gone from the browser immediately, before any network call
    set({ status: "anon", user: null, notice: notice ?? null }); // so a 401 during sign-out can't re-enter this
    if (token) await api.logout().catch(() => {}); // revokes the token on the server
    resetTransport(); // the next sign-in negotiates fresh keys
    useApp.getState().reset();
    set({ token: null, expiresAt: null });
  },

  renewIfNeeded: async () => {
    const { expiresAt, status } = get();
    if (status !== "authed" || !expiresAt) return;
    if (new Date(expiresAt).getTime() - Date.now() < 30 * 60_000) {
      try {
        get().setSession(await api.refresh());
      } catch {}
    }
  },
}));

bindAuth(
  () => useAuth.getState().token,
  () => {
    if (useAuth.getState().status === "authed") void useAuth.getState().logout("Your session ended. Please sign in again.");
  },
);
