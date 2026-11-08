"use client";

import { create } from "zustand";
import { api } from "@/lib/api";
import { useToasts } from "./useToasts";

export type AdminSection = "add" | "manage" | "flags" | "knowledge";

interface AdminState {
  open: boolean;
  section: AdminSection;
  unreviewed: number;
  openAdmin: (section?: AdminSection) => void;
  close: () => void;
  setSection: (s: AdminSection) => void;
  /** Ask the API how many flagged prompts nobody has reviewed yet; tell the admin when a new one arrives. */
  poll: () => Promise<void>;
  setUnreviewed: (n: number) => void;
}

let first = true;

export const useAdmin = create<AdminState>()((set, get) => ({
  open: false,
  section: "manage",
  unreviewed: 0,
  openAdmin: (section) => set({ open: true, ...(section ? { section } : {}) }),
  close: () => set({ open: false }),
  setSection: (section) => set({ section }),
  setUnreviewed: (unreviewed) => set({ unreviewed }),
  poll: async () => {
    try {
      const { unreviewed } = await api.admin.flagSummary();
      const before = get().unreviewed;
      set({ unreviewed });
      if (!first && unreviewed > before)
        useToasts.getState().push(
          `${unreviewed - before} new flagged prompt${unreviewed - before === 1 ? "" : "s"} to review`, "warn",
        );
      first = false;
    } catch {}
  },
}));
