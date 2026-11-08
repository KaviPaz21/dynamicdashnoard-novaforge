"use client";

import { useState } from "react";
import { SourceCard } from "@/components/data/DataManager";
import { Icon } from "@/components/ui/Icon";
import { useApp } from "@/store/useApp";
import { useAuth } from "@/store/useAuth";

type Which = "private" | "global";

/** Read-only overview of what the copilot can draw on: your private knowledge and the knowledge shared with everyone.
 *  Other people's private knowledge is never sent to this browser, the API only returns what the user may read. */
export function KnowledgeView() {
  const sources = useApp((s) => s.sources);
  const setTab = useApp((s) => s.setTab);
  const isAdmin = useAuth((s) => s.user?.role === "admin");
  const [which, setWhich] = useState<Which>("private");
  const [q, setQ] = useState("");

  const mine = sources.filter((s) => s.visibility === "private");
  const shared = sources.filter((s) => s.visibility === "global");
  const list = (which === "private" ? mine : shared).filter(
    (s) => !q.trim() || `${s.name} ${s.filename} ${s.topics.join(" ")}`.toLowerCase().includes(q.trim().toLowerCase()),
  );

  const tab = (id: Which, label: string, icon: "lock" | "globe", count: number) => (
    <button
      role="tab" aria-selected={which === id} onClick={() => setWhich(id)}
      className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm transition ${which === id ? "bg-panel font-medium text-ink shadow-[var(--tile-shadow)]" : "text-ink2 hover:text-ink"}`}
    >
      <Icon name={icon} size={14} /> {label} <span className="tabular rounded-full bg-ink/8 px-1.5 font-mono text-[11px]">{count}</span>
    </button>
  );

  return (
    <div className="mx-auto max-w-4xl space-y-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Knowledge base" className="inline-flex gap-1 rounded-xl bg-ink/6 p-1">
          {tab("private", "My knowledge", "lock", mine.length)}
          {tab("global", "Global knowledge", "globe", shared.length)}
        </div>
        <label className="relative">
          <span className="sr-only">Search knowledge</span>
          <Icon name="search" size={14} className="absolute top-1/2 left-3 -translate-y-1/2 text-mute" />
          <input
            value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…"
            className="w-56 rounded-lg border border-line2 bg-panel py-2 pr-3 pl-8 text-sm outline-none focus:border-accent"
          />
        </label>
      </div>

      <p className="flex items-start gap-2 rounded-xl bg-panel2 px-4 py-3 text-[13px] leading-relaxed text-ink2">
        <Icon name={which === "private" ? "lock" : "globe"} size={14} className="mt-0.5 shrink-0 text-accent" />
        {which === "private" ? (
          <span>
            Private to you: nobody else, not even an administrator, can see or use these files.
            Add or remove them in <button onClick={() => setTab("data")} className="font-medium text-accent underline underline-offset-2">Data</button>.
          </span>
        ) : (
          <span>
            Shared with everyone in this workspace and available to the copilot for all users.{" "}
            {isAdmin ? "Manage it from Admin → Global knowledge." : "Only administrators can change it."}
          </span>
        )}
      </p>

      <div className="space-y-3">
        {list.map((s) => <SourceCard key={s.id} s={s} readOnly />)}
        {!list.length && (
          <p className="py-10 text-center text-sm text-mute">
            {q.trim() ? "Nothing matches your search." : which === "private" ? "You haven't added anything yet." : "No global knowledge yet."}
          </p>
        )}
      </div>
    </div>
  );
}
