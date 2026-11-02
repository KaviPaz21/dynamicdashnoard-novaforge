"use client";

import { Icon, type IconName } from "@/components/ui/Icon";
import { useApp, type Tab } from "@/store/useApp";

function relative(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function Dot({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className="flex items-center gap-2 text-[11px] text-side-ink2" title={label}>
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${ok ? "bg-[#7ee0cf]" : "bg-[#ffd27a]"}`} />
      <span className="truncate font-mono">{label}</span>
    </span>
  );
}

export function Sidebar() {
  const collapsed = useApp((s) => s.sidebarCollapsed);
  const toggleSidebar = useApp((s) => s.toggleSidebar);
  const tab = useApp((s) => s.tab);
  const setTab = useApp((s) => s.setTab);
  const sheets = useApp((s) => s.sheets);
  const activeId = useApp((s) => s.activeSheetId);
  const openSheet = useApp((s) => s.openSheet);
  const createSheet = useApp((s) => s.createSheet);
  const deleteSheet = useApp((s) => s.deleteSheet);
  const sourceCount = useApp((s) => s.sources.length);
  const theme = useApp((s) => s.theme);
  const setTheme = useApp((s) => s.setTheme);
  const health = useApp((s) => s.health);

  const recent = [...sheets].sort((a, b) => b.updated_at.localeCompare(a.updated_at));

  const item = (active: boolean) =>
    `relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition ${
      active ? "bg-side-active font-medium text-side-active-ink shadow-sm" : "text-side-ink hover:bg-white/12"
    } ${collapsed ? "justify-center px-0" : ""}`;

  const views: { id: Tab; label: string; icon: IconName; badge?: number }[] = [
    { id: "dashboard", label: "Dashboard", icon: "dashboard" },
    { id: "data", label: "Data", icon: "database", badge: sourceCount || undefined },
  ];
  const label = "px-3 pt-2 pb-1.5 font-mono text-[10px] tracking-[0.14em] text-side-ink2 uppercase";

  return (
    <aside
      className={`side-panel flex shrink-0 flex-col rounded-[22px] transition-[width] duration-200 ${collapsed ? "w-[68px]" : "w-64"}`}
      aria-label="Navigation"
    >
      <div className={`flex items-center gap-2.5 px-3 pt-4 pb-3 ${collapsed ? "flex-col" : ""}`}>
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-side-active text-side-active-ink" aria-hidden>
          <Icon name="flame" size={19} />
        </div>
        {!collapsed && (
          <div className="min-w-0 flex-1 leading-tight">
            <div className="font-display text-xl font-semibold tracking-tight">NovaForge</div>
            <div className="truncate font-mono text-[10px] tracking-[0.14em] text-side-ink2 uppercase">Fire-safety copilot</div>
          </div>
        )}
        <button
          onClick={toggleSidebar}
          className="rounded-lg p-1.5 text-side-ink2 transition hover:bg-white/15 hover:text-side-ink"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <Icon name="angle-double-small-right" size={16} /> : <Icon name="angle-double-small-left" size={16} />}
        </button>
      </div>

      <nav className="px-2.5" aria-label="Views">
        {!collapsed && <div className={label}>Views</div>}
        <ul className="space-y-0.5">
          {views.map(({ id, label: text, icon, badge }) => (
            <li key={id}>
              <button onClick={() => setTab(id)} className={item(tab === id)} aria-current={tab === id ? "page" : undefined} title={collapsed ? text : undefined}>
                <Icon name={icon} size={17} />
                {!collapsed && <span className="flex-1">{text}</span>}
                {!collapsed && badge !== undefined && (
                  <span className={`tabular rounded-full px-1.5 font-mono text-[11px] ${tab === id ? "bg-side-active-ink/12" : "bg-white/18"}`}>{badge}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <div className="mt-3 flex min-h-0 flex-1 flex-col px-2.5">
        <div className={`flex items-center ${collapsed ? "justify-center" : "justify-between pr-1"}`}>
          {!collapsed && (
            <span className={label}>
              Sheets <span className="tabular">{sheets.length || ""}</span>
            </span>
          )}
          <button
            onClick={() => createSheet()}
            className="mt-1 rounded-lg p-1 text-side-ink2 transition hover:bg-white/15 hover:text-side-ink"
            aria-label="New sheet" title="New sheet"
          >
            <Icon name="plus" size={15} />
          </button>
        </div>
        <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto pb-2">
          {recent.map((s) => {
            const active = s.id === activeId && tab === "dashboard";
            return (
              <li key={s.id} className="group/row relative">
                <button onClick={() => openSheet(s.id)} className={item(active)} aria-current={active ? "page" : undefined} title={collapsed ? s.name : undefined}>
                  {collapsed ? (
                    <span className={`grid h-7 w-7 place-items-center rounded-lg font-mono text-[11px] ${active ? "bg-side-active-ink/12" : "bg-white/15"}`}>
                      {s.name.trim().slice(0, 2).toUpperCase() || "S"}
                    </span>
                  ) : (
                    <>
                      <Icon name="document" size={16} className="shrink-0" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{s.name}</span>
                        <span className={`block truncate text-[11px] ${active ? "text-side-active-ink/70" : "text-side-ink2"}`}>
                          {s.widget_count} visual{s.widget_count === 1 ? "" : "s"} · {relative(s.updated_at)}
                        </span>
                      </span>
                    </>
                  )}
                </button>
                {!collapsed && (
                  <button
                    onClick={() => confirm(`Delete sheet “${s.name}”?`) && deleteSheet(s.id)}
                    className={`absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 opacity-0 transition group-hover/row:opacity-100 focus-visible:opacity-100 ${active ? "text-side-active-ink hover:bg-side-active-ink/10" : "text-side-ink2 hover:bg-white/15 hover:text-side-ink"}`}
                    aria-label={`Delete ${s.name}`}
                  >
                    <Icon name="cross-small" size={13} />
                  </button>
                )}
              </li>
            );
          })}
          {!sheets.length && !collapsed && (
            <li className="px-3 py-2 text-xs leading-relaxed text-side-ink2">No saved sheets yet. Ask the copilot for a dashboard, or press + to start a blank one.</li>
          )}
        </ul>
      </div>

      <div className="space-y-3 border-t border-white/15 p-3">
        {collapsed ? (
          <button
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            className="mx-auto grid h-9 w-9 place-items-center rounded-xl text-side-ink transition hover:bg-white/15"
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`} title="Switch theme"
          >
            {theme === "dark" ? <Icon name="sun" size={17} /> : <Icon name="moon" size={17} />}
          </button>
        ) : (
          <div role="group" aria-label="Theme" className="grid grid-cols-2 gap-1 rounded-xl bg-black/15 p-1">
            {(["light", "dark"] as const).map((t) => (
              <button
                key={t} onClick={() => setTheme(t)} aria-pressed={theme === t}
                className={`flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium transition ${theme === t ? "bg-side-active text-side-active-ink shadow-sm" : "text-side-ink2 hover:text-side-ink"}`}
              >
                {t === "light" ? <Icon name="sun" size={14} /> : <Icon name="moon" size={14} />}
                {t === "light" ? "Light" : "Dark"}
              </button>
            ))}
          </div>
        )}
        {!collapsed && (
          <div className="space-y-1 px-1">
            {health ? (
              <>
                <Dot ok={health.store === "cosmos"} label={health.store === "cosmos" ? "Cosmos DB" : "In-memory store"} />
                <Dot ok={health.llm_configured} label={health.llm_configured ? health.llm_model : "LLM not configured"} />
              </>
            ) : (
              <Dot ok={false} label="API offline" />
            )}
            <a
              href="https://www.flaticon.com/uicons" target="_blank" rel="noreferrer"
              className="block pt-1 text-[10px] text-side-ink2 underline-offset-2 hover:underline"
            >
              Icons by Flaticon UIcons
            </a>
          </div>
        )}
        {collapsed && (
          <div className="flex justify-center" title={health ? `${health.store} · ${health.llm_model}` : "API offline"}>
            <span className={`h-2 w-2 rounded-full ${health && health.llm_configured ? "bg-[#7ee0cf]" : "bg-[#ffd27a]"}`} />
          </div>
        )}
      </div>
    </aside>
  );
}
