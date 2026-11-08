"use client";

import dynamic from "next/dynamic";
import { useEffect } from "react";
import { ChangePasswordScreen } from "@/components/auth/ChangePasswordScreen";
import { LoginScreen } from "@/components/auth/LoginScreen";
import { Logo } from "@/components/brand/Logo";
import { ChatWidget } from "@/components/chat/ChatWidget";
import { DataManager } from "@/components/data/DataManager";
import { DashboardCanvas } from "@/components/dashboard/DashboardCanvas";
import { KnowledgeView } from "@/components/knowledge/KnowledgeView";
import { Header } from "@/components/shell/Header";
import { Sidebar } from "@/components/shell/Sidebar";
import { Toaster } from "@/components/ui/Toaster";
import { useAdmin } from "@/store/useAdmin";
import { useApp } from "@/store/useApp";
import { useAuth } from "@/store/useAuth";

// The admin UI is only ever downloaded by administrators; the API enforces the role regardless
const AdminModal = dynamic(() => import("@/components/admin/AdminModal").then((m) => m.AdminModal), { ssr: false });

function Workspace({ userId, isAdmin }: { userId: string; isAdmin: boolean }) {
  const tab = useApp((s) => s.tab);
  const processing = useApp((s) => s.sources.some((x) => x.status === "processing" || x.status === "deleting"));
  const dirty = useApp((s) => s.dirty);
  const saveState = useApp((s) => s.saveState);
  const dashboard = useApp((s) => s.dashboard);
  const filters = useApp((s) => s.filters);
  const refreshSources = useApp((s) => s.refreshSources);
  const refreshHealth = useApp((s) => s.refreshHealth);
  const adminOpen = useAdmin((s) => s.open);

  useEffect(() => {
    Promise.resolve(useApp.persist.rehydrate()).then(() => {
      const s = useApp.getState();
      s.adoptOwner(userId); // clears anything a previous person left in this browser
      s.initTheme();
      s.loadSheets();
      s.loadSessions();
      const current = useApp.getState().conversationId;
      if (current) s.openConversation(current);
    });
    refreshHealth();
    refreshSources();
  }, [userId, refreshHealth, refreshSources]);

  useEffect(() => {
    if (!isAdmin) return;
    const admin = useAdmin.getState();
    admin.poll();
    const t = setInterval(admin.poll, 30_000);
    return () => clearInterval(t);
  }, [isAdmin]);

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
          {tab === "dashboard" ? <DashboardCanvas /> : tab === "data" ? <DataManager /> : <KnowledgeView />}
        </div>
      </main>
      <ChatWidget />
      {isAdmin && adminOpen && <AdminModal />}
    </div>
  );
}

export default function Home() {
  const status = useAuth((s) => s.status);
  const user = useAuth((s) => s.user);

  useEffect(() => {
    void useAuth.getState().init();
  }, []);

  useEffect(() => {
    if (status !== "authed") return;
    const t = setInterval(() => void useAuth.getState().renewIfNeeded(), 60_000);
    return () => clearInterval(t);
  }, [status]);

  let screen;
  if (status === "loading")
    screen = (
      <div className="fixed inset-0 grid place-items-center bg-white" aria-busy="true" aria-label="Loading">
        <Logo size={34} className="animate-pulse" />
      </div>
    );
  else if (status === "anon" || !user) screen = <LoginScreen />;
  else if (user.must_change_password) screen = <ChangePasswordScreen />;
  else screen = <Workspace key={user.id} userId={user.id} isAdmin={user.role === "admin"} />;

  return (
    <>
      {screen}
      <Toaster />
    </>
  );
}
