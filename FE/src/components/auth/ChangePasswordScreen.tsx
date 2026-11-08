"use client";

import { useState, type FormEvent } from "react";
import { errorText } from "@/lib/api";
import { Icon } from "@/components/ui/Icon";
import { useAuth } from "@/store/useAuth";
import { AuthShell, field, heading, label, primaryBtn, secondaryBtn, subhead } from "./AuthShell";

export function passwordProblem(pw: string): string | null {
  if (pw.length < 10) return "Use at least 10 characters";
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return "Use both letters and digits";
  return null;
}

/** Shown right after sign-in when an administrator created or reset the account (temporary password). */
export function ChangePasswordScreen() {
  const user = useAuth((s) => s.user);
  const changePassword = useAuth((s) => s.changePassword);
  const logout = useAuth((s) => s.logout);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const problem = next ? passwordProblem(next) : null;
  const mismatch = again && again !== next ? "Passwords don't match" : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || problem || mismatch) return;
    setBusy(true);
    setError(null);
    try {
      await changePassword(current, next);
    } catch (err) {
      setError(errorText(err, "Could not change the password"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell>
      <h1 className={heading}>New password</h1>
      <p className={subhead}>Hi {user?.name.split(" ")[0]}, replace your temporary password to continue</p>
      <form onSubmit={submit} className="mt-8 space-y-4">
        <div>
          <label htmlFor="cur" className={label}>Temporary password</label>
          <input id="cur" type="password" autoComplete="current-password" required autoFocus value={current} onChange={(e) => setCurrent(e.target.value)} className={field} disabled={busy} />
        </div>
        <div>
          <label htmlFor="new" className={label}>New password</label>
          <input id="new" type="password" autoComplete="new-password" required value={next} onChange={(e) => setNext(e.target.value)} className={field} disabled={busy} aria-describedby="rules" />
          <p id="rules" className={`mt-1.5 font-mono text-[11px] ${problem ? "font-semibold text-[#0b0b0d]" : "text-neutral-500"}`}>
            At least 10 characters, with letters and digits.
          </p>
        </div>
        <div>
          <label htmlFor="again" className={label}>Repeat new password</label>
          <input id="again" type="password" autoComplete="new-password" required value={again} onChange={(e) => setAgain(e.target.value)} className={field} disabled={busy} />
          {mismatch && <p className="mt-1.5 font-mono text-[11px] font-semibold text-[#0b0b0d]">{mismatch}</p>}
        </div>
        <div aria-live="polite" className="min-h-5 font-mono text-xs">{error && <p className="font-semibold text-[#0b0b0d]" role="alert">{error}</p>}</div>
        <button type="submit" disabled={busy || !current || !next || !again || !!problem || !!mismatch} className={primaryBtn}>
          {busy ? <span className="inline-flex items-center justify-center gap-2"><Icon name="spinner" size={14} className="animate-spin" /> Saving…</span> : "Save and continue"}
        </button>
        <button type="button" onClick={() => logout()} className={secondaryBtn}>Sign out</button>
      </form>
    </AuthShell>
  );
}
