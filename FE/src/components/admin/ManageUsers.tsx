"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { api } from "@/lib/api";
import { fmtDateTime, nf, timeAgo } from "@/lib/time";
import type { Role, User, UserDetail } from "@/lib/types";
import { useAuth } from "@/store/useAuth";
import { useToasts } from "@/store/useToasts";
import { btnGhost, inputCls, TempPassword } from "./AddUsers";

const Chip = ({ children, tone = "plain" }: { children: React.ReactNode; tone?: "plain" | "accent" | "warn" | "crit" }) => (
  <span className={`rounded px-1.5 py-0.5 font-mono text-[10px] tracking-wide uppercase ${tone === "accent" ? "bg-accent/15 text-accent" : tone === "warn" ? "bg-warn/15 text-warn" : tone === "crit" ? "bg-crit/15 text-crit" : "bg-ink/8 text-ink2"}`}>{children}</span>
);

const Stat = ({ label, value }: { label: string; value: string | number }) => (
  <div className="rounded-lg bg-panel2 px-3 py-2.5">
    <div className="tabular font-display text-xl font-semibold">{typeof value === "number" ? nf(value) : value}</div>
    <div className="text-[11px] text-mute">{label}</div>
  </div>
);

function Detail({ id, onChanged, onDeleted }: { id: string; onChanged: () => void; onDeleted: () => void }) {
  const me = useAuth((s) => s.user);
  const push = useToasts((s) => s.push);
  const [d, setD] = useState<UserDetail | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [temp, setTemp] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<"reset" | "delete" | null>(null);
  const [typed, setTyped] = useState("");

  // the parent mounts this with key={id}, so switching user starts from a clean state
  const load = useCallback(
    () => api.admin.user(id).then(setD).catch((e) => push(e instanceof Error ? e.message : "Could not load the user", "error")),
    [id, push],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      push(e instanceof Error ? e.message : "Action failed", "error");
    } finally {
      setBusy(null);
    }
  };

  if (!d) return <div className="p-8 text-sm text-mute"><Icon name="spinner" size={16} className="animate-spin" /></div>;
  const self = me?.id === d.id;
  const u = d.usage;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start gap-3">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-accent/15 font-display text-lg font-semibold text-accent">{d.name.slice(0, 1).toUpperCase()}</span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-display text-xl font-semibold">{d.name}</h3>
          <p className="truncate text-sm text-ink2">{d.email}</p>
          <p className="mt-1 flex flex-wrap items-center gap-1.5">
            <Chip tone={d.role === "admin" ? "accent" : "plain"}>{d.role}</Chip>
            <Chip tone={d.active ? "plain" : "crit"}>{d.active ? "active" : "deactivated"}</Chip>
            {d.must_change_password && <Chip tone="warn">temp password</Chip>}
            <span className="font-mono text-[11px] text-mute">{d.id}</span>
          </p>
        </div>
      </header>

      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
        <div><dt className="text-[11px] text-mute">Last active</dt><dd title={fmtDateTime(d.last_active)}>{timeAgo(d.last_active)}</dd></div>
        <div><dt className="text-[11px] text-mute">Last sign-in</dt><dd>{fmtDateTime(d.last_login)}</dd></div>
        <div><dt className="text-[11px] text-mute">Created</dt><dd>{fmtDateTime(d.created_at)}</dd></div>
      </dl>

      <section aria-label="Usage">
        <h4 className="mb-2 font-mono text-[10px] tracking-[0.14em] text-mute uppercase">Usage</h4>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Prompts" value={u.prompts} />
          <Stat label="Sessions" value={u.sessions} />
          <Stat label="Tokens (total)" value={u.tokens_total} />
          <Stat label="Flagged prompts" value={u.flagged} />
          <Stat label="Tokens in" value={u.tokens_in} />
          <Stat label="Tokens out" value={u.tokens_out} />
          <Stat label="Files uploaded" value={u.uploads} />
          <Stat label="Private files" value={d.private_sources} />
          <Stat label="Saved chats" value={d.conversations} />
          <Stat label="Sheets" value={d.sheets} />
          <Stat label="Flags to review" value={d.flags_unreviewed} />
        </div>
      </section>

      <section aria-label="Settings" className="space-y-3">
        <h4 className="font-mono text-[10px] tracking-[0.14em] text-mute uppercase">Settings</h4>
        {self && <p className="text-xs text-mute">This is your own account: you can&apos;t deactivate, demote or delete yourself.</p>}

        <div className="flex flex-wrap items-center gap-2">
          <button
            disabled={self || busy !== null} className={btnGhost}
            onClick={() => run("active", async () => { setD(await api.admin.patchUser(d.id, { active: !d.active })); onChanged(); push(d.active ? "User deactivated and signed out" : "User activated"); })}
          >
            <Icon name={d.active ? "lock" : "check"} size={14} /> {d.active ? "Deactivate" : "Activate"}
          </button>

          <label className="inline-flex items-center gap-2 text-sm text-ink2">
            Role
            <select
              value={d.role} disabled={self || busy !== null} className={`${inputCls} w-auto! py-1.5!`} aria-label="Role"
              onChange={(e) => run("role", async () => { setD(await api.admin.patchUser(d.id, { role: e.target.value as Role })); onChanged(); push("Role updated. Their old sessions were ended."); })}
            >
              <option value="client">Client</option>
              <option value="admin">Admin</option>
            </select>
          </label>

          <button disabled={busy !== null} className={btnGhost} onClick={() => setConfirming(confirming === "reset" ? null : "reset")} aria-expanded={confirming === "reset"}>
            <Icon name="key" size={14} /> Reset password
          </button>
          <button disabled={self || busy !== null} className={`${btnGhost} text-crit! enabled:hover:border-crit/60!`} onClick={() => setConfirming(confirming === "delete" ? null : "delete")} aria-expanded={confirming === "delete"}>
            <Icon name="trash" size={14} /> Delete user
          </button>
        </div>

        {confirming === "reset" && (
          <div className="rounded-lg border border-line p-3 text-sm">
            <p>Generate a new temporary password for <b>{d.name}</b>? Their current password stops working and they are signed out everywhere.</p>
            <div className="mt-2 flex gap-2">
              <button className={btnGhost} onClick={() => run("reset", async () => { setTemp((await api.admin.resetPassword(d.id)).temp_password); setConfirming(null); await load(); })}>
                {busy === "reset" ? <Icon name="spinner" size={14} className="animate-spin" /> : null} Yes, reset it
              </button>
              <button className="px-2 text-sm text-ink2 hover:text-ink" onClick={() => setConfirming(null)}>Cancel</button>
            </div>
          </div>
        )}

        {confirming === "delete" && (
          <div className="rounded-lg border border-crit/40 bg-crit/6 p-3 text-sm">
            <p>
              This permanently deletes <b>{d.name}</b> together with their {d.conversations} chat{d.conversations === 1 ? "" : "s"}, {d.sheets} sheet{d.sheets === 1 ? "" : "s"} and {d.private_sources} private file{d.private_sources === 1 ? "" : "s"}.
              Flagged prompts stay on record. Type <code className="font-mono">{d.email}</code> to confirm.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <input value={typed} onChange={(e) => setTyped(e.target.value)} className={`${inputCls} w-64!`} aria-label="Type the email to confirm" />
              <button
                disabled={typed.trim().toLowerCase() !== d.email || busy !== null}
                className="rounded-lg bg-crit px-3.5 py-2 text-sm font-medium text-white disabled:opacity-40"
                onClick={() => run("delete", async () => { await api.admin.deleteUser(d.id); push("User deleted"); onDeleted(); })}
              >
                Delete permanently
              </button>
              <button className="px-2 text-sm text-ink2 hover:text-ink" onClick={() => { setConfirming(null); setTyped(""); }}>Cancel</button>
            </div>
          </div>
        )}

        {temp && <TempPassword value={temp} who={d.name} onDone={() => setTemp(null)} />}
      </section>
    </div>
  );
}

export function ManageUsers() {
  const push = useToasts((s) => s.push);
  const [users, setUsers] = useState<User[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const load = useCallback(
    () => api.admin.users().then(setUsers).catch((e) => push(e instanceof Error ? e.message : "Could not load users", "error")),
    [push],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const list = (users ?? []).filter((u) => !q.trim() || `${u.name} ${u.id} ${u.email}`.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <div className="flex h-full min-h-120 gap-5 max-md:flex-col">
      <div className="flex w-full shrink-0 flex-col md:w-62.5">
        <h2 className="mb-3 font-display text-2xl font-semibold tracking-tight">Manage users</h2>
        <label className="relative mb-2">
          <span className="sr-only">Search users</span>
          <Icon name="search" size={13} className="absolute top-1/2 left-3 -translate-y-1/2 text-mute" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, ID, email" className={`${inputCls} pl-8!`} />
        </label>
        <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto" aria-label="Users">
          {users === null && <li className="p-3 text-sm text-mute"><Icon name="spinner" size={14} className="animate-spin" /></li>}
          {list.map((u) => (
            <li key={u.id}>
              <button
                onClick={() => setSelected(u.id)} aria-current={selected === u.id ? "true" : undefined}
                className={`w-full rounded-lg px-3 py-2 text-left transition ${selected === u.id ? "bg-accent/14" : "hover:bg-ink/6"}`}
              >
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-medium">{u.name}</span>
                  {u.role === "admin" && <Icon name="shield-check" size={11} className="shrink-0 text-accent" />}
                  {!u.active && <span className="rounded bg-crit/15 px-1 font-mono text-[9px] text-crit uppercase">off</span>}
                </span>
                <span className="block truncate font-mono text-[11px] text-mute">{u.id}</span>
              </button>
            </li>
          ))}
          {users && !list.length && <li className="p-3 text-sm text-mute">No users match.</li>}
        </ul>
      </div>
      <div className="min-w-0 flex-1 md:border-l md:border-line md:pl-6">
        {selected ? (
          <Detail key={selected} id={selected} onChanged={load} onDeleted={() => { setSelected(null); void load(); }} />
        ) : (
          <div className="grid h-full place-items-center text-center text-sm text-mute">
            <div><Icon name="users" size={28} className="mx-auto mb-2 opacity-60" /> Select a user to see their role, activity and usage.</div>
          </div>
        )}
      </div>
    </div>
  );
}
