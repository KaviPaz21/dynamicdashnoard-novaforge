"use client";

import { errorText } from "@/lib/api";
import { Icon } from "@/components/ui/Icon";
import { useEffect, useMemo, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { KbScope } from "@/lib/types";
import { useApp, type Message } from "@/store/useApp";
import { useAuth } from "@/store/useAuth";
import { useToasts } from "@/store/useToasts";
import { PromptNav } from "./PromptNav";
import { SessionsSidebar } from "./SessionsSidebar";
import { SmokeOrb } from "./SmokeOrb";
import { TracePanel } from "./TracePanel";

function Bubble({ m, isLast }: { m: Message; isLast: boolean }) {
  const send = useApp((s) => s.send);
  const busy = useApp((s) => s.busy);
  const [showSrc, setShowSrc] = useState(false);
  const [showTrace, setShowTrace] = useState(false);

  if (m.role === "user")
    return (
      <div className="rise flex flex-col items-end gap-1" data-prompt>
        <div className="max-w-[88%] rounded-2xl rounded-br-md bg-accent px-3.5 py-2 text-sm leading-relaxed font-medium whitespace-pre-wrap text-on-accent">
          {m.content}
        </div>
        {!!m.attachments?.length && (
          <div className="flex max-w-[88%] flex-wrap justify-end gap-1">
            {m.attachments.map((a) => (
              <span key={a} className="inline-flex max-w-full items-center gap-1 rounded-full bg-ink/6 px-2 py-0.5 text-[11px] text-ink2">
                <Icon name="paperclip-vertical" size={10} /> <span className="truncate">{a}</span>
              </span>
            ))}
          </div>
        )}
      </div>
    );

  return (
    <div className="rise space-y-2">
      <div className={`rounded-2xl rounded-tl-md border px-3.5 py-3 ${m.error ? "border-crit/40 bg-crit/10" : m.blocked ? "border-warn/40 bg-warn/8" : "border-line bg-panel2"}`}>
        {m.blocked ? (
          <span className="mb-1.5 inline-flex items-center gap-1 rounded bg-warn/15 px-1.5 py-0.5 font-mono text-[10px] tracking-wider text-warn uppercase">
            <Icon name="shield-exclamation" size={10} /> flagged · refused
          </span>
        ) : (
          m.intent && !m.error && (
            <span className="mb-1.5 inline-block rounded bg-ink/5 px-1.5 py-0.5 font-mono text-[10px] tracking-wider text-mute uppercase">
              {m.intent.replace("_", " ")}
            </span>
          )
        )}
        <div className="md text-[13.5px] leading-relaxed text-ink2">
          {m.error ? <p className="text-crit">{m.content}</p> : <Markdown remarkPlugins={[remarkGfm]}>{m.content}</Markdown>}
        </div>

        {!!m.citations?.length && (
          <div className="mt-3 border-t border-line pt-2">
            <button onClick={() => setShowSrc((v) => !v)} className="flex items-center gap-1 text-xs text-ink2 hover:text-ink" aria-expanded={showSrc}>
              <Icon name="angle-small-right" size={12} className={`transition ${showSrc ? "rotate-90" : ""}`} />
              <Icon name="document" size={12} /> {m.citations.length} passages
            </button>
            {showSrc && (
              <ol className="mt-2 space-y-2">
                {m.citations.map((c, i) => (
                  <li key={i} className="rounded-md bg-bg/60 p-2 text-xs">
                    <div className="mb-1 font-mono text-[11px] text-accent">
                      [{i + 1}] {c.filename}{c.page ? ` · p.${c.page}` : ""}
                    </div>
                    <p className="line-clamp-4 text-mute">{c.snippet}</p>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}

        {!!m.trace?.length && (
          <div className="mt-2">
            <button onClick={() => setShowTrace((v) => !v)} className="flex items-center gap-1 font-mono text-[11px] text-mute hover:text-ink2" aria-expanded={showTrace}>
              <Icon name="angle-small-right" size={11} className={`transition ${showTrace ? "rotate-90" : ""}`} />
              how I got this · {m.trace.length} steps
            </button>
            {showTrace && <div className="mt-2"><TracePanel events={m.trace} /></div>}
          </div>
        )}
      </div>

      {isLast && !!m.suggestions?.length && (
        <div className="flex flex-wrap gap-1.5">
          {m.suggestions.map((s) => (
            <button key={s} disabled={busy} onClick={() => send(s)}
              className="rounded-full border border-line2 px-3 py-1 text-left text-xs text-ink2 transition hover:border-accent/60 hover:text-ink disabled:opacity-50">
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const SCOPES: { id: KbScope; label: string; icon: "books" | "lock" | "globe"; hint: string }[] = [
  { id: "all", label: "Both", icon: "books", hint: "Answer from your local knowledge and the global knowledge" },
  { id: "local", label: "Local", icon: "lock", hint: "Answer only from your own private knowledge" },
  { id: "global", label: "Global", icon: "globe", hint: "Answer only from the knowledge shared with everyone" },
];

function KnowledgeSwitch() {
  const scope = useApp((s) => s.kbScope);
  const setScope = useApp((s) => s.setKbScope);
  const sources = useApp((s) => s.sources);
  const busy = useApp((s) => s.busy);
  const ready = (v: "private" | "global") => sources.filter((s) => s.visibility === v && !s.conversation_id && s.status === "ready").length;
  const count: Record<KbScope, number> = { all: ready("private") + ready("global"), local: ready("private"), global: ready("global") };

  return (
    <div className="flex items-center gap-2 border-b border-line px-4 py-2">
      <span className="font-mono text-[10px] tracking-[0.12em] text-mute uppercase">Knowledge</span>
      <div role="radiogroup" aria-label="Knowledge the copilot may use" className="ml-auto inline-flex gap-0.5 rounded-lg bg-ink/6 p-0.5">
        {SCOPES.map((o) => (
          <button
            key={o.id} role="radio" aria-checked={scope === o.id} title={o.hint} disabled={busy} onClick={() => setScope(o.id)}
            className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] transition disabled:opacity-60 ${scope === o.id ? "bg-panel font-medium text-ink shadow-[var(--tile-shadow)]" : "text-ink2 hover:text-ink"}`}
          >
            <Icon name={o.icon} size={11} /> {o.label}
            <span className="tabular font-mono text-[10px] text-mute">{count[o.id]}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function Attachments() {
  const conv = useApp((s) => s.conversationId);
  const sources = useApp((s) => s.sources);
  const removeSource = useApp((s) => s.removeSource);
  const mine = sources.filter((s) => conv && s.conversation_id === conv);
  if (!mine.length) return null;
  return (
    <ul className="mb-2 flex flex-wrap gap-1.5" aria-label="Files attached to this chat">
      {mine.map((s) => (
        <li key={s.id} className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-line2 bg-panel2 py-0.5 pr-1 pl-2.5 text-[11.5px] text-ink2">
          {s.status === "processing" ? <Icon name="spinner" size={11} className="animate-spin text-warn" />
            : s.status === "failed" ? <Icon name="exclamation" size={11} className="text-crit" />
            : <Icon name={s.kind === "tabular" ? "table" : "document"} size={11} className="text-accent" />}
          <span className="max-w-[150px] truncate" title={s.status === "failed" ? (s.error ?? "failed") : s.filename}>{s.name || s.filename}</span>
          <button onClick={() => confirm(`Remove “${s.name || s.filename}” from this chat? The file is deleted.`) && removeSource(s.id)}
            className="rounded-full p-0.5 text-mute hover:bg-ink/12 hover:text-ink" aria-label={`Remove ${s.filename}`}>
            <Icon name="cross-small" size={12} />
          </button>
        </li>
      ))}
    </ul>
  );
}

interface PanelProps {
  onClose?: () => void;
  expanded?: boolean;
  onToggleExpand?: () => void;
}

export function ChatPanel({ onClose, expanded = false, onToggleExpand }: PanelProps) {
  const messages = useApp((s) => s.messages);
  const busy = useApp((s) => s.busy);
  const trace = useApp((s) => s.trace);
  const health = useApp((s) => s.health);
  const conversationId = useApp((s) => s.conversationId);
  const waiting = useApp((s) => s.sources.some((x) => x.status === "processing" && !!x.conversation_id && x.conversation_id === s.conversationId));
  const sessionsOpen = useApp((s) => s.sessionsOpen);
  const toggleSessions = useApp((s) => s.toggleSessions);
  const send = useApp((s) => s.send);
  const attach = useApp((s) => s.attach);
  const newConversation = useApp((s) => s.newConversation);
  const exportConversation = useApp((s) => s.exportConversation);
  const firstName = useAuth((s) => s.user?.name.split(" ")[0]);
  const push = useToasts((s) => s.push);
  const [text, setText] = useState("");
  const [uploading, setUploading] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);

  const prompts = useMemo(
    () => messages.filter((m) => m.role === "user").map((m) => ({ id: m.id, text: m.content })),
    [messages],
  );

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, trace.length, busy]);

  useEffect(() => {
    // switching to another chat: jump to its end without animating through the whole thing
    requestAnimationFrame(() => scroller.current?.scrollTo({ top: scroller.current.scrollHeight }));
  }, [conversationId]);

  const submit = () => {
    if (!text.trim() || busy || waiting) return;
    send(text);
    setText("");
    if (area.current) area.current.style.height = "auto";
  };

  const onFiles = async (list: FileList | null) => {
    if (!list?.length) return;
    setUploading(true);
    try {
      const { rejected } = await attach([...list]);
      rejected.forEach((r) => push(`${r.filename}: ${r.error}`, "error"));
    } catch (e) {
      push(errorText(e, "Upload failed"), "error");
    } finally {
      setUploading(false);
      if (file.current) file.current.value = "";
    }
  };

  const iconBtn = "rounded-md p-1.5 text-mute transition hover:bg-ink/10 hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent";

  return (
    <div className="flex h-full min-h-0">
      {sessionsOpen && <SessionsSidebar />}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-1.5 border-b border-line px-3 py-3">
          <button onClick={toggleSessions} className={iconBtn} aria-pressed={sessionsOpen} aria-label={sessionsOpen ? "Hide chat history" : "Show chat history"} title="Chat history">
            <Icon name="menu-burger" size={15} />
          </button>
          <SmokeOrb size={24} />
          <h2 className="font-display text-base font-semibold">Copilot</h2>
          <button onClick={newConversation} disabled={busy} className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-ink2 hover:bg-ink/10 disabled:opacity-40" title="New conversation">
            <Icon name="plus" size={13} /> New
          </button>
          <button onClick={exportConversation} disabled={busy || !messages.length} className={iconBtn} aria-label="Export this conversation as a PDF" title="Export as PDF (reference copy)">
            <Icon name="file-pdf" size={15} />
          </button>
          {onToggleExpand && (
            <button onClick={onToggleExpand} className={iconBtn} aria-label={expanded ? "Make the window smaller" : "Make the window larger"} title={expanded ? "Smaller" : "Larger"}>
              {expanded ? <Icon name="compress" size={14} /> : <Icon name="expand" size={14} />}
            </button>
          )}
          {onClose && (
            <button onClick={onClose} className={iconBtn} aria-label="Close copilot" title="Close (Esc)">
              <Icon name="cross-small" size={16} />
            </button>
          )}
        </header>

        <KnowledgeSwitch />

        {health && !health.assistant_ready && (
          <p className="border-b border-line bg-panel2 px-4 py-2 text-xs text-ink2" role="status">
            The assistant is unavailable right now. Please try again shortly or contact your administrator.
          </p>
        )}

        <div className="relative min-h-0 flex-1">
          <div ref={scroller} className="relative h-full space-y-4 overflow-y-auto py-4 pr-7 pl-4" aria-live="polite">
            {!messages.length && (
              <div className="pt-4 text-sm leading-relaxed text-mute">
                <p className="font-display text-lg font-semibold text-ink">{firstName ? `Hi ${firstName}, what` : "What"} do you want to understand?</p>
                <p className="mt-2">
                  Ask for a dashboard, a ranking, a comparison or an explanation. I decide whether to query your tables,
                  search your papers, or both, and show you my thinking on the way. Attach a file with the paperclip to
                  include it in this chat.
                </p>
              </div>
            )}
            {messages.map((m, i) => <Bubble key={m.id} m={m} isLast={i === messages.length - 1} />)}
            {busy && (
              <div className="rise rounded-2xl rounded-tl-md border border-line bg-panel2 px-3.5 py-3">
                <TracePanel events={trace} live />
              </div>
            )}
          </div>
          <PromptNav scroller={scroller} prompts={prompts} />
        </div>

        <footer className="border-t border-line p-3">
          <Attachments />
          <div className="flex items-end gap-1.5 rounded-xl border border-line2 bg-bg/70 p-1.5 transition focus-within:border-accent/70">
            <button onClick={() => file.current?.click()} disabled={uploading || busy} className="rounded-lg p-2 text-mute hover:bg-ink/10 hover:text-ink disabled:opacity-40" title="Attach a file to this chat" aria-label="Attach a file to this chat">
              {uploading ? <Icon name="spinner" size={16} className="animate-spin" /> : <Icon name="paperclip-vertical" size={16} />}
            </button>
            <input ref={file} type="file" multiple className="hidden" accept=".csv,.tsv,.xlsx,.xlsm,.xls,.json,.jsonl,.pdf,.txt,.md,.docx"
              onChange={(e) => onFiles(e.target.files)} />
            <textarea
              ref={area} rows={1} value={text} maxLength={8000} placeholder="Ask about your data…" aria-label="Message the copilot"
              onChange={(e) => {
                setText(e.target.value);
                e.target.style.height = "auto";
                e.target.style.height = `${Math.min(e.target.scrollHeight, 140)}px`;
              }}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
              className="max-h-36 min-h-9 flex-1 resize-none bg-transparent px-1.5 py-2 text-sm outline-none placeholder:text-mute"
            />
            <button onClick={submit} disabled={!text.trim() || busy || waiting} aria-label="Send"
              title={waiting ? "Waiting for the attached file to finish processing" : "Send"}
              className="rounded-lg bg-accent p-2 text-on-accent transition enabled:hover:brightness-110 disabled:opacity-30">
              <Icon name="arrow-up" size={16} />
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
