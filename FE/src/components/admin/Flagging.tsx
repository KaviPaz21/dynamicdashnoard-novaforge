"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { api, errorText } from "@/lib/api";
import { fmtDateTime, timeAgo } from "@/lib/time";
import type { Flag, FlaggedUser } from "@/lib/types";
import { useAdmin } from "@/store/useAdmin";
import { useToasts } from "@/store/useToasts";
import { btnGhost } from "./AddUsers";

const SEV = {
  high: "bg-crit/15 text-crit",
  medium: "bg-warn/15 text-warn",
  low: "bg-ink/8 text-ink2",
} as const;

const label = (c: string) => c.replaceAll("_", " ");

function FlagCard({ f, onReview }: { f: Flag; onReview: (id: string, reviewed: boolean) => void }) {
  return (
    <article className={`rounded-xl border p-4 ${f.reviewed ? "border-line opacity-80" : "border-warn/40"}`}>
      <header className="flex flex-wrap items-center gap-2">
        <span className={`rounded px-1.5 py-0.5 font-mono text-[10px] tracking-wide uppercase ${SEV[f.severity]}`}>{f.severity}</span>
        {f.categories.map((c) => <span key={c} className="rounded bg-ink/8 px-1.5 py-0.5 text-[11px] text-ink2">{label(c)}</span>)}
        <span className="rounded px-1.5 py-0.5 text-[11px] text-ink2 ring-1 ring-line2">{f.blocked ? "refused" : "answered"}</span>
        <time className="ml-auto text-[11px] text-mute" dateTime={f.created_at} title={fmtDateTime(f.created_at)}>{fmtDateTime(f.created_at)}</time>
      </header>

      <div className="mt-3 space-y-3">
        <div>
          <h4 className="mb-1 font-mono text-[10px] tracking-[0.14em] text-mute uppercase">User prompt</h4>
          <p className="rounded-lg bg-panel2 px-3 py-2 text-sm wrap-break-word whitespace-pre-wrap">{f.prompt}</p>
        </div>
        <div>
          <h4 className="mb-1 font-mono text-[10px] tracking-[0.14em] text-mute uppercase">Model response</h4>
          <p className="max-h-40 overflow-y-auto rounded-lg bg-panel2 px-3 py-2 text-sm wrap-break-word whitespace-pre-wrap text-ink2">{f.response || "—"}</p>
        </div>
      </div>

      <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 text-[12px] sm:grid-cols-2">
        <div className="flex gap-2"><dt className="text-mute">Reason</dt><dd className="min-w-0 wrap-break-word">{f.reason || "—"}</dd></div>
        <div className="flex gap-2"><dt className="text-mute">Detected by</dt><dd>{f.detection}</dd></div>
        <div className="flex gap-2"><dt className="text-mute">User</dt><dd className="font-mono">{f.user_id}</dd></div>
        <div className="flex gap-2"><dt className="text-mute">Email</dt><dd className="min-w-0 truncate">{f.user_email || "—"}</dd></div>
        <div className="flex gap-2 sm:col-span-2"><dt className="text-mute">Conversation</dt><dd className="font-mono break-all">{f.conversation_id || "—"}</dd></div>
      </dl>

      <footer className="mt-3 flex items-center gap-3">
        <button onClick={() => onReview(f.id, !f.reviewed)} className={btnGhost}>
          <Icon name={f.reviewed ? "rotate-right" : "check"} size={13} /> {f.reviewed ? "Reopen" : "Mark reviewed"}
        </button>
        {f.reviewed && <span className="text-[11px] text-mute">Reviewed {timeAgo(f.reviewed_at)}</span>}
      </footer>
    </article>
  );
}

export function Flagging() {
  const push = useToasts((s) => s.push);
  const [users, setUsers] = useState<FlaggedUser[] | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<{ userId: string; list: Flag[] } | null>(null);

  // default to the first user until the admin picks one
  const selected = picked ?? users?.[0]?.user_id ?? null;
  const flags = loaded && loaded.userId === selected ? loaded.list : null;

  const loadUsers = useCallback(
    () =>
      api.admin
        .flaggedUsers()
        .then((list) => {
          setUsers(list);
          useAdmin.getState().setUnreviewed(list.reduce((n, u) => n + u.unreviewed, 0));
        })
        .catch((e) => push(errorText(e, "Could not load flagged prompts"), "error")),
    [push],
  );

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  useEffect(() => {
    if (!selected) return;
    let live = true;
    api.admin
      .flags(selected)
      .then((list) => live && setLoaded({ userId: selected, list }))
      .catch(() => live && setLoaded({ userId: selected, list: [] }));
    return () => {
      live = false;
    };
  }, [selected]);

  const review = async (id: string, reviewed: boolean) => {
    try {
      const updated = await api.admin.reviewFlag(id, reviewed);
      setLoaded((l) => (l ? { ...l, list: l.list.map((f) => (f.id === id ? updated : f)) } : l));
      void loadUsers();
    } catch (e) {
      push(errorText(e, "Could not update the flag"), "error");
    }
  };

  return (
    <div className="flex h-full min-h-120 gap-5 max-md:flex-col">
      <div className="flex w-full shrink-0 flex-col md:w-62.5">
        <h2 className="mb-1 font-display text-2xl font-semibold tracking-tight">Flagging</h2>
        <p className="mb-3 text-xs text-ink2">Prompts the safety check flagged, grouped by user ID.</p>
        <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto" aria-label="Users with flagged prompts">
          {users === null && <li className="p-3 text-sm text-mute"><Icon name="spinner" size={14} className="animate-spin" /></li>}
          {users?.map((u) => (
            <li key={u.user_id}>
              <button
                onClick={() => setPicked(u.user_id)} aria-current={selected === u.user_id ? "true" : undefined}
                className={`w-full rounded-lg px-3 py-2 text-left transition ${selected === u.user_id ? "bg-accent/14" : "hover:bg-ink/6"}`}
              >
                <span className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{u.user_name}</span>
                  {u.unreviewed > 0 && <span className="tabular rounded-full bg-warn px-1.5 font-mono text-[10.5px] font-semibold text-white">{u.unreviewed}</span>}
                </span>
                <span className="flex items-center gap-2 font-mono text-[11px] text-mute">
                  <span className="truncate">{u.user_id}</span>
                  <span className={`rounded px-1 text-[9px] uppercase ${SEV[u.severity]}`}>{u.severity}</span>
                </span>
                <span className="block text-[11px] text-mute">{u.total} flag{u.total === 1 ? "" : "s"} · {timeAgo(u.last_at)}</span>
              </button>
            </li>
          ))}
          {users && !users.length && (
            <li className="rounded-lg bg-panel2 p-4 text-center text-sm text-mute">
              <Icon name="shield-check" size={22} className="mx-auto mb-1.5 text-good" /> Nothing flagged. Clean so far.
            </li>
          )}
        </ul>
      </div>

      <div className="min-w-0 flex-1 space-y-3 md:border-l md:border-line md:pl-6">
        {selected && flags === null && <Icon name="spinner" size={16} className="animate-spin text-mute" />}
        {flags?.map((f) => <FlagCard key={f.id} f={f} onReview={review} />)}
        {!selected && users?.length === 0 && <div className="grid h-full place-items-center text-sm text-mute">No flagged prompts to show.</div>}
      </div>
    </div>
  );
}
