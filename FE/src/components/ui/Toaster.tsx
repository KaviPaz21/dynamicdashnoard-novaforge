"use client";

import { Icon } from "@/components/ui/Icon";
import { useToasts } from "@/store/useToasts";

const TONE = {
  info: "border-line2 bg-panel text-ink",
  warn: "border-warn/50 bg-panel text-ink",
  error: "border-crit/50 bg-panel text-ink",
} as const;

export function Toaster() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);
  return (
    <div className="pointer-events-none fixed bottom-5 left-5 z-[70] flex w-[min(380px,calc(100vw-2.5rem))] flex-col gap-2" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} role="status" className={`rise pointer-events-auto flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-sm shadow-[var(--drag-shadow)] ${TONE[t.tone]}`}>
          <Icon name={t.tone === "info" ? "info" : "triangle-warning"} size={15} className={`mt-0.5 ${t.tone === "error" ? "text-crit" : t.tone === "warn" ? "text-warn" : "text-accent"}`} />
          <span className="flex-1">{t.text}</span>
          <button onClick={() => dismiss(t.id)} aria-label="Dismiss" className="rounded p-0.5 text-mute hover:text-ink"><Icon name="cross-small" size={13} /></button>
        </div>
      ))}
    </div>
  );
}
