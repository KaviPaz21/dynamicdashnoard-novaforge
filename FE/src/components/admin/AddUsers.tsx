"use client";

import { useState, type FormEvent } from "react";
import { Icon } from "@/components/ui/Icon";
import { api } from "@/lib/api";
import type { Role, User } from "@/lib/types";
import { useToasts } from "@/store/useToasts";

export const inputCls = "w-full rounded-lg border border-line2 bg-bg/60 px-3 py-2 text-sm outline-none transition focus:border-accent disabled:opacity-60";
export const btnPrimary = "inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent transition enabled:hover:brightness-110 disabled:opacity-50";
export const btnGhost = "inline-flex items-center justify-center gap-2 rounded-lg border border-line2 px-3.5 py-2 text-sm text-ink2 transition enabled:hover:border-accent/60 enabled:hover:text-ink disabled:opacity-50";

export function TempPassword({ value, who, onDone }: { value: string; who: string; onDone?: () => void }) {
  const push = useToasts((s) => s.push);
  const [shown, setShown] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      push("Temporary password copied");
    } catch {
      push("Copy failed: select the password and copy it manually", "warn");
    }
  };
  return (
    <div className="rounded-xl border border-accent/40 bg-accent/8 p-4" role="status">
      <p className="text-sm font-medium">Temporary password for {who}</p>
      <p className="mt-0.5 text-xs text-ink2">Shown only once. Share it securely; they must choose their own password at first sign-in.</p>
      <div className="mt-3 flex items-center gap-2">
        <code className="flex-1 rounded-lg bg-bg px-3 py-2 font-mono text-[15px] tracking-wider select-all">{shown ? value : "•".repeat(value.length)}</code>
        <button onClick={() => setShown((v) => !v)} className={btnGhost} aria-label={shown ? "Hide password" : "Show password"}><Icon name={shown ? "eye-crossed" : "eye"} size={14} /></button>
        <button onClick={copy} className={btnGhost}><Icon name="copy" size={14} /> Copy</button>
      </div>
      {onDone && <button onClick={onDone} className="mt-3 text-xs text-ink2 underline underline-offset-2 hover:text-ink">Done, hide it</button>}
    </div>
  );
}

export function AddUsers() {
  const push = useToasts((s) => s.push);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("client");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ user: User; temp_password: string } | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api.admin.createUser(name.trim(), email.trim(), role);
      setCreated(res);
      setName("");
      setEmail("");
      setRole("client");
    } catch (err) {
      push(err instanceof Error ? err.message : "Could not create the user", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <header>
        <h2 className="font-display text-2xl font-semibold tracking-tight">Add users</h2>
        <p className="mt-1 text-sm text-ink2">Create an account. A temporary password is generated; the person sets their own at first sign-in.</p>
      </header>

      {created && <TempPassword value={created.temp_password} who={`${created.user.name} (${created.user.id})`} onDone={() => setCreated(null)} />}

      <form onSubmit={submit} className="space-y-4">
        <div>
          <label htmlFor="au-name" className="mb-1 block text-xs font-medium text-ink2">Name</label>
          <input id="au-name" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} className={inputCls} disabled={busy} />
        </div>
        <div>
          <label htmlFor="au-email" className="mb-1 block text-xs font-medium text-ink2">Email</label>
          <input id="au-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} disabled={busy} />
        </div>
        <fieldset>
          <legend className="mb-1 block text-xs font-medium text-ink2">Role</legend>
          <div className="grid grid-cols-2 gap-2">
            {([
              ["client", "Client", "Uses the copilot, dashboards and their own knowledge."],
              ["admin", "Admin", "Everything a client can, plus users, flags and global knowledge."],
            ] as const).map(([id, label, hint]) => (
              <label key={id} className={`cursor-pointer rounded-lg border p-3 text-sm transition ${role === id ? "border-accent bg-accent/8" : "border-line2 hover:border-accent/50"}`}>
                <input type="radio" name="role" value={id} checked={role === id} onChange={() => setRole(id)} className="sr-only" />
                <span className="block font-medium">{label}</span>
                <span className="mt-0.5 block text-xs text-ink2">{hint}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <button type="submit" disabled={busy || !name.trim() || !email.trim()} className={btnPrimary}>
          {busy ? <Icon name="spinner" size={14} className="animate-spin" /> : <Icon name="user-add" size={14} />} Create user
        </button>
      </form>

    </div>
  );
}
