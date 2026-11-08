"use client";

import { useState } from "react";
import { Icon, type IconName } from "@/components/ui/Icon";
import type { TraceEvent } from "@/lib/types";

const KIND: Record<TraceEvent["kind"], { icon: IconName; tone: string; label: string }> = {
  guard: { icon: "shield-check", tone: "text-good", label: "Safety" },
  select: { icon: "books", tone: "text-accent", label: "Knowledge" },
  thought: { icon: "bulb", tone: "text-ink2", label: "Thinking" },
  query: { icon: "database", tone: "text-accent", label: "Query" },
  retry: { icon: "rotate-right", tone: "text-warn", label: "Retry" },
  retrieval: { icon: "search", tone: "text-accent", label: "Search" },
  info: { icon: "info", tone: "text-mute", label: "Info" },
};

interface Hit {
  file: string;
  page?: number | null;
  score: number;
  snippet: string;
}

function Entry({ e }: { e: TraceEvent }) {
  const [open, setOpen] = useState(false);
  const k = KIND[e.kind] ?? KIND.info;
  const flagged = e.kind === "guard" && /flagged/i.test(e.title);
  const failed = e.kind === "query" && e.data?.ok === false;
  const hits = (e.data?.hits as Hit[] | undefined) ?? [];
  const icon: IconName = flagged ? "shield-exclamation" : failed ? "triangle-warning" : k.icon;
  const tone = flagged || failed ? "text-crit" : k.tone;

  return (
    <li className="rise flex gap-2.5">
      <Icon name={icon} size={13} className={`mt-[3px] ${tone}`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-[12px] leading-snug font-medium text-ink">{e.title}</span>
          <span className="shrink-0 font-mono text-[9.5px] tracking-wider text-mute uppercase">{k.label}</span>
        </div>
        {e.detail && <p className="mt-0.5 text-[11.5px] leading-snug wrap-break-word whitespace-pre-line text-mute">{e.detail}</p>}
        {!!hits.length && (
          <>
            <button onClick={() => setOpen((v) => !v)} aria-expanded={open} className="mt-1 inline-flex items-center gap-1 text-[11px] text-accent hover:underline">
              <Icon name="angle-small-right" size={11} className={`transition ${open ? "rotate-90" : ""}`} /> {hits.length} passages
            </button>
            {open && (
              <ul className="mt-1 space-y-1.5">
                {hits.map((h, i) => (
                  <li key={i} className="rounded-md bg-bg/60 p-1.5 text-[11px]">
                    <div className="font-mono text-[10.5px] text-accent">
                      {h.file}{h.page ? ` · p.${h.page}` : ""} · {(h.score * 100).toFixed(0)}% match
                    </div>
                    <p className="line-clamp-2 text-mute">{h.snippet}</p>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </li>
  );
}

/** The agent's work, step by step: safety check, which knowledge it chose, its thinking, every query, retries, retrieved passages. */
export function TracePanel({ events, live = false }: { events: TraceEvent[]; live?: boolean }) {
  return (
    <ol className="space-y-2" aria-label="Agent activity">
      {events.map((e, i) => <Entry key={`${e.ts}-${i}`} e={e} />)}
      {live && (
        <li className="flex items-center gap-2.5 text-[12px] text-accent">
          <span className="pulse-dot ml-[3px] inline-block h-1.5 w-1.5 rounded-full bg-accent" /> working…
        </li>
      )}
    </ol>
  );
}
