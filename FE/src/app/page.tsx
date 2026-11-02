"use client";

import { useEffect } from "react";
import { ChatWidget } from "@/components/chat/ChatWidget";
import { DataManager } from "@/components/data/DataManager";
import { DashboardCanvas } from "@/components/dashboard/DashboardCanvas";
import { Header } from "@/components/shell/Header";
import { Sidebar } from "@/components/shell/Sidebar";
import { useApp } from "@/store/useApp";

export default function Home() {
  const tab = useApp((s) => s.tab);
  const processing = useApp((s) => s.sources.some((x) => x.status === "processing"));
  const dirty = useApp((s) => s.dirty);
  const saveState = useApp((s) => s.saveState);
  const dashboard = useApp((s) => s.dashboard);
  const filters = useApp((s) => s.filters);
  const refreshSources = useApp((s) => s.refreshSources);
  const refreshHealth = useApp((s) => s.refreshHealth);

  useEffect(() => {
    Promise.resolve(useApp.persist.rehydrate()).then(() => {
      const s = useApp.getState();
      s.initTheme();
      s.loadSheets();
    });
    refreshHealth();
    refreshSources();
  }, [refreshHealth, refreshSources]);

  useEffect(() => {
    if (!processing) return;
    const t = setInterval(refreshSources, 1500);
    return () => clearInterval(t);
  }, [processing, refreshSources]);

  useEffect(() => {
    if (!dirty || saveState === "error") return;
    const t = setTimeout(() => useApp.getState().saveNow(), 800);
    return () => clearTimeout(t);
  }, [dirty, dashboard, filters, saveState]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        const s = useApp.getState();
        if (s.activeSheetId) s.saveNow();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="stage flex h-screen gap-3 p-3">
      <Sidebar />
      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        <Header />
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-28">
          {tab === "dashboard" ? <DashboardCanvas /> : <DataManager />}
        </div>
      </main>
      <ChatWidget />
    </div>
  );
}
