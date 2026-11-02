"use client";

import { useEffect } from "react";
import { useApp } from "@/store/useApp";
import { ChatPanel } from "./ChatPanel";
import { SmokeOrb } from "./SmokeOrb";

export function ChatWidget() {
  const open = useApp((s) => s.chatOpen);
  const expanded = useApp((s) => s.chatExpanded);
  const busy = useApp((s) => s.busy);
  const unread = useApp((s) => s.unread);
  const hasHistory = useApp((s) => s.messages.length > 0);
  const setOpen = useApp((s) => s.setChatOpen);
  const toggleExpanded = useApp((s) => s.toggleChatExpanded);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector("[role=dialog][aria-modal=true]")) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  if (open) {
    return (
      <section
        role="complementary" aria-label="Copilot"
        className={`chat-dock card-surface relative z-40 flex shrink-0 flex-col overflow-hidden rounded-[22px] max-lg:fixed max-lg:inset-3 max-lg:w-auto ${
          expanded ? "w-[min(680px,45vw)]" : "w-[min(440px,32vw)] min-w-[360px]"
        }`}
      >
        <ChatPanel onClose={() => setOpen(false)} expanded={expanded} onToggleExpand={toggleExpanded} />
      </section>
    );
  }

  return (
    <div className="fixed right-5 bottom-5 z-40 flex items-center gap-3">
      {!hasHistory && (
        <span className="rise hidden rounded-full bg-panel px-3.5 py-1.5 text-xs font-medium text-ink2 shadow-[var(--card-shadow)] sm:block">
          Ask the copilot
        </span>
      )}
      <button
        onClick={() => setOpen(true)}
        aria-label="Open copilot" aria-expanded={false}
        title={busy ? "Copilot is working…" : "Open copilot"}
        className="group relative rounded-full transition-transform duration-300 ease-out hover:scale-110 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent active:scale-95"
      >
        <SmokeOrb busy={busy} size={64} />
        {unread && (
          <span className="absolute top-0 right-0 grid h-3.5 w-3.5 place-items-center" aria-label="New answer">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#22d3ee] opacity-70" />
            <span className="relative h-3 w-3 rounded-full bg-[#22d3ee] ring-2 ring-bg" />
          </span>
        )}
      </button>
    </div>
  );
}
