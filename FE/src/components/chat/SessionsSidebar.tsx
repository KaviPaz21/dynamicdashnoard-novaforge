"use client";

import { useState } from "react";
import { Icon } from "@/components/ui/Icon";
import type { ChatSessionInfo } from "@/lib/types";
import { useApp } from "@/store/useApp";

function bucket(iso: string | null): string {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return "Earlier";
  const days = Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return "Previous 7 days";
  return "Earlier";
}

function Row({ s, active }: { s: ChatSessionInfo; active: boolean }) {
  const open = useApp((st) => st.openConversation);
  const remove = useApp((st) => st.deleteConversation);
  const busy = useApp((st) => st.busy);
  const [confirm, setConfirm] = useState(false);

  return (
    <li className="group/row relative">
      <button
        onClick={() => open(s.id)} disabled={busy} aria-current={active ? "true" : undefined} title={s.title}
        className={`w-full rounded-lg px-2.5 py-2 pr-8 text-left text-[13px] transition disabled:opacity-60 ${active ? "bg-accent/14 font-medium text-ink" : "text-ink2 hover:bg-ink/6 hover:text-ink"}`}
      >
        <span className="block truncate">{s.title || "New chat"}</span>
      </button>
      <button
        onClick={() => (confirm ? remove(s.id) : setConfirm(true))}
        onBlur={() => setConfirm(false)}
        aria-label={confirm ? `Confirm delete ${s.title}` : `Delete ${s.title}`}
        className={`absolute top-1/2 right-1 -translate-y-1/2 rounded-md p-1.5 text-[11px] font-medium transition focus-visible:opacity-100 ${confirm ? "bg-crit px-2 text-white opacity-100" : "text-mute opacity-0 group-hover/row:opacity-100 hover:bg-crit/15 hover:text-crit"}`}
      >
        {confirm ? "Delete?" : <Icon name="trash" size={13} />}
      </button>
    </li>
  );
}

/** Previous chats of the signed-in user. Titles are generated automatically from the first message. */
export function SessionsSidebar() {
  const sessions = useApp((s) => s.sessions);
  const current = useApp((s) => s.conversationId);
  const busy = useApp((s) => s.busy);
  const newConversation = useApp((s) => s.newConversation);

  const groups: [string, ChatSessionInfo[]][] = [];
  for (const s of sessions) {
    const b = bucket(s.updated_at);
    const g = groups.find((x) => x[0] === b);
    if (g) g[1].push(s);
    else groups.push([b, [s]]);
  }

  return (
    <aside className="flex w-[216px] shrink-0 flex-col border-r border-line bg-panel2/60" aria-label="Chat history">
      <div className="p-2.5">
        <button
          onClick={newConversation} disabled={busy}
          className="flex w-full items-center gap-2 rounded-lg border border-line2 px-3 py-2 text-sm text-ink transition hover:border-accent/60 hover:bg-panel disabled:opacity-50"
        >
          <Icon name="plus" size={14} /> New chat
        </button>
      </div>
      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-3" aria-label="Previous chats">
        {groups.map(([label, items]) => (
          <section key={label} className="mb-2">
            <h3 className="px-2.5 pt-2 pb-1 font-mono text-[10px] tracking-[0.12em] text-mute uppercase">{label}</h3>
            <ul className="space-y-0.5">{items.map((s) => <Row key={s.id} s={s} active={s.id === current} />)}</ul>
          </section>
        ))}
        {!sessions.length && <p className="px-2.5 py-4 text-xs leading-relaxed text-mute">Your conversations will show up here, named automatically.</p>}
      </nav>
    </aside>
  );
}
