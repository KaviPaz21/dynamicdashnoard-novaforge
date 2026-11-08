"use client";

import { useEffect, useRef } from "react";
import { DataManager } from "@/components/data/DataManager";
import { Icon, type IconName } from "@/components/ui/Icon";
import { useAdmin, type AdminSection } from "@/store/useAdmin";
import { AddUsers } from "./AddUsers";
import { Flagging } from "./Flagging";
import { ManageUsers } from "./ManageUsers";

const NAV: { id: AdminSection; label: string; icon: IconName }[] = [
  { id: "add", label: "Add users", icon: "user-add" },
  { id: "manage", label: "Manage users", icon: "users" },
  { id: "flags", label: "Flagging", icon: "flag" },
  { id: "knowledge", label: "Global knowledge", icon: "globe" },
];

/** Centre pop-up with its own side navigation. Everything inside talks to /api/admin/* (or to the source endpoints with
 *  visibility=global), which re-check the administrator role on the server for every single request. */
export function AdminModal() {
  const section = useAdmin((s) => s.section);
  const setSection = useAdmin((s) => s.setSection);
  const close = useAdmin((s) => s.close);
  const unreviewed = useAdmin((s) => s.unreviewed);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "Tab" && panel.current) {
        const f = panel.current.querySelectorAll<HTMLElement>("button:not([disabled]),input,select,textarea,a[href],[tabindex]:not([tabindex='-1'])");
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, [close]);

  return (
    <div
      className="fixed inset-0 z-[60] grid place-items-center bg-black/50 p-3 backdrop-blur-[2px] sm:p-6"
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <div
        ref={panel} role="dialog" aria-modal="true" aria-label="Administration" tabIndex={-1}
        className="chat-pop card-surface flex h-[min(700px,92vh)] w-[min(1060px,96vw)] overflow-hidden rounded-[22px] outline-none"
      >
        <nav className="flex w-[200px] shrink-0 flex-col border-r border-line bg-panel2/70 p-3 max-sm:w-[64px]" aria-label="Administration sections">
          <div className="mb-3 flex items-center gap-2 px-2 pt-1 font-display text-base font-semibold max-sm:justify-center">
            <Icon name="shield-check" size={17} className="text-accent" /> <span className="max-sm:hidden">Admin</span>
          </div>
          <ul className="space-y-0.5">
            {NAV.map((n) => (
              <li key={n.id}>
                <button
                  onClick={() => setSection(n.id)} aria-current={section === n.id ? "page" : undefined} title={n.label}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition max-sm:justify-center ${section === n.id ? "bg-accent/14 font-medium text-ink" : "text-ink2 hover:bg-ink/6 hover:text-ink"}`}
                >
                  <Icon name={n.icon} size={15} />
                  <span className="flex-1 max-sm:hidden">{n.label}</span>
                  {n.id === "flags" && unreviewed > 0 && (
                    <span className="tabular rounded-full bg-warn px-1.5 font-mono text-[10.5px] font-semibold text-white max-sm:hidden">{unreviewed}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
          <button onClick={close} className="mt-auto flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-mute transition hover:bg-ink/6 hover:text-ink max-sm:justify-center">
            <Icon name="cross-small" size={15} /> <span className="max-sm:hidden">Close</span>
          </button>
        </nav>

        <section className="min-w-0 flex-1 overflow-y-auto p-6">
          {section === "add" && <AddUsers />}
          {section === "manage" && <ManageUsers />}
          {section === "flags" && <Flagging />}
          {section === "knowledge" && <DataManager scope="global" embedded />}
        </section>
      </div>
    </div>
  );
}
