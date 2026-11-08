"use client";

import { useState, type FormEvent } from "react";
import { errorText } from "@/lib/api";
import { Icon } from "@/components/ui/Icon";
import { useAuth } from "@/store/useAuth";
import { AuthShell, field, heading, label, primaryBtn, subhead } from "./AuthShell";

export function LoginScreen() {
  const login = useAuth((s) => s.login);
  const notice = useAuth((s) => s.notice);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await login(email.trim(), password);
    } catch (err) {
      setError(errorText(err, "Sign-in failed"));
      setPassword("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell>
      <h1 className={heading}>Sign In</h1>
      <p className={subhead}>Continue to access your dashboard</p>

      <form onSubmit={submit} className="mt-9 space-y-4" noValidate>
        <div>
          <label htmlFor="email" className={label}>Email</label>
          <input
            id="email" type="email" autoComplete="username" autoFocus required value={email} disabled={busy}
            onChange={(e) => setEmail(e.target.value)} placeholder="Enter your email" className={field}
          />
        </div>
        <div>
          <label htmlFor="password" className={label}>Password</label>
          <div className="relative">
            <input
              id="password" type={show ? "text" : "password"} autoComplete="current-password" required value={password}
              disabled={busy} onChange={(e) => setPassword(e.target.value)} placeholder="Enter your password" className={`${field} pr-11`}
            />
            <button
              type="button" onClick={() => setShow((v) => !v)} aria-label={show ? "Hide password" : "Show password"}
              className="absolute top-1/2 right-3 -translate-y-1/2 rounded-full p-1.5 text-neutral-500 hover:text-[#0b0b0d]"
            >
              <Icon name={show ? "eye-crossed" : "eye"} size={15} />
            </button>
          </div>
        </div>

        <div aria-live="polite" className="min-h-5 font-mono text-xs">
          {error && <p className="font-semibold text-[#0b0b0d]" role="alert">{error}</p>}
          {!error && notice && <p className="text-neutral-600">{notice}</p>}
        </div>

        <button type="submit" disabled={busy || !email.trim() || !password} className={primaryBtn}>
          {busy ? (
            <span className="inline-flex items-center justify-center gap-2"><Icon name="spinner" size={14} className="animate-spin" /> Signing in…</span>
          ) : (
            "Sign In"
          )}
        </button>
      </form>

      <p className="mt-8 text-center font-mono text-xs text-neutral-400">Accounts are created by an administrator.</p>
      <p className="mt-3 flex items-center justify-center gap-1.5 font-mono text-[11px] text-neutral-400">
        <Icon name="lock" size={11} /> Encrypted before it leaves this browser
      </p>
    </AuthShell>
  );
}
