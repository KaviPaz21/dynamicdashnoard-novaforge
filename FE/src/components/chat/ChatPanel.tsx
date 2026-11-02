"use client";

import { Icon } from "@/components/ui/Icon";
import { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useApp, type Message, type Step } from "@/store/useApp";
import { SmokeOrb } from "./SmokeOrb";

const NODE_LABEL: Record<string, string> = {
  load_context: "Reading the data catalog",
  route: "Understanding your intent",
  plan_widgets: "Designing visuals and queries",
  execute_queries: "Querying the data",
  retrieve_docs: "Searching documents",
  synthesize: "Writing the answer",
};

function StepList({ steps, live = false }: { steps: Step[]; live?: boolean }) {
  return (
    <ol className="space-y-1.5 font-mono text-[11px] text-mute">
      {steps.map((s, i) => (
        <li key={i} className="flex gap-2">
          <span className="text-good">✓</span>
          <span>
            <span className="text-ink2">{NODE_LABEL[s.node] ?? s.node}</span>
            {s.detail && <span className="text-mute"> — {s.detail}</span>}
          </span>
        </li>
      ))}
      {live && (
        <li className="flex items-center gap-2 text-accent">
          <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-accent" /> working…
        </li>
      )}
    </ol>
  );
}

function Bubble({ m, isLast }: { m: Message; isLast: boolean }) {
  const send = useApp((s) => s.send);
  const busy = useApp((s) => s.busy);
  const [showSrc, setShowSrc] = useState(false);
  const [showTrace, setShowTrace] = useState(false);

  if (m.role === "user")
    return (
      <div className="rise flex justify-end">
        <div className="max-w-[88%] rounded-2xl rounded-br-md bg-accent px-3.5 py-2 text-sm leading-relaxed font-medium text-on-accent">
          {m.content}
        </div>
      </div>
    );

  return (
    <div className="rise space-y-2">
      <div className={`rounded-2xl rounded-tl-md border px-3.5 py-3 ${m.error ? "border-crit/40 bg-crit/10" : "border-line bg-panel2"}`}>
        {m.intent && !m.error && (
          <span className="mb-1.5 inline-block rounded bg-ink/5 px-1.5 py-0.5 font-mono text-[10px] tracking-wider text-mute uppercase">
            {m.intent.replace("_", " ")}
          </span>
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

        {!!m.steps?.length && (
          <div className="mt-2">
            <button onClick={() => setShowTrace((v) => !v)} className="flex items-center gap-1 font-mono text-[11px] text-mute hover:text-ink2" aria-expanded={showTrace}>
              <Icon name="angle-small-right" size={11} className={`transition ${showTrace ? "rotate-90" : ""}`} /> agent trace
            </button>
            {showTrace && <div className="mt-1.5"><StepList steps={m.steps} /></div>}
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

interface PanelProps {
  onClose?: () => void;
  expanded?: boolean;
  onToggleExpand?: () => void;
}

export function ChatPanel({ onClose, expanded = false, onToggleExpand }: PanelProps) {
  const messages = useApp((s) => s.messages);
  const busy = useApp((s) => s.busy);
  const steps = useApp((s) => s.steps);
  const health = useApp((s) => s.health);
  const sources = useApp((s) => s.sources);
  const send = useApp((s) => s.send);
  const upload = useApp((s) => s.upload);
  const newConversation = useApp((s) => s.newConversation);
  const [text, setText] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, steps.length, busy]);

  const submit = () => {
    if (!text.trim() || busy) return;
    send(text);
    setText("");
    if (area.current) area.current.style.height = "auto";
  };

  const ready = sources.filter((s) => s.status === "ready").length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-2 border-b border-line px-4 py-3">
        <SmokeOrb size={26} />
        <h2 className="font-display text-base font-semibold">Copilot</h2>
        <span className="font-mono text-[11px] text-mute">{ready} source{ready === 1 ? "" : "s"} ready</span>
        <button onClick={newConversation} className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-ink2 hover:bg-ink/10" title="New conversation">
          <Icon name="plus" size={13} /> New
        </button>
        {onToggleExpand && (
          <button onClick={onToggleExpand} className="rounded-md p-1.5 text-mute hover:bg-ink/10 hover:text-ink" aria-label={expanded ? "Make the window smaller" : "Make the window larger"} title={expanded ? "Smaller" : "Larger"}>
            {expanded ? <Icon name="compress" size={14} /> : <Icon name="expand" size={14} />}
          </button>
        )}
        {onClose && (
          <button onClick={onClose} className="rounded-md p-1.5 text-mute hover:bg-ink/10 hover:text-ink" aria-label="Close copilot" title="Close (Esc)">
            <Icon name="cross-small" size={16} />
          </button>
        )}
      </header>

      {health && !health.llm_configured && (
        <p className="border-b border-warn/30 bg-warn/10 px-4 py-2 text-xs text-warn" role="status">
          The language model isn&apos;t configured. Set <code className="font-mono">LLM_API_KEY</code> in <code className="font-mono">BE/.env</code> and restart the API.
        </p>
      )}

      <div ref={scroller} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4" aria-live="polite">
        {!messages.length && (
          <div className="pt-4 text-sm leading-relaxed text-mute">
            <p className="font-display text-lg font-semibold text-ink">What do you want to understand?</p>
            <p className="mt-2">
              Ask for a dashboard, a ranking, a comparison or an explanation. I decide whether to query your tables,
              search your papers, or both, and whether KPIs are needed at all.
            </p>
          </div>
        )}
        {messages.map((m, i) => <Bubble key={m.id} m={m} isLast={i === messages.length - 1} />)}
        {busy && (
          <div className="rise rounded-2xl rounded-tl-md border border-line bg-panel2 px-3.5 py-3">
            <StepList steps={steps} live />
          </div>
        )}
      </div>

      <footer className="border-t border-line p-3">
        <div className="flex items-end gap-1.5 rounded-xl border border-line2 bg-bg/70 p-1.5 transition focus-within:border-accent/70">
          <button onClick={() => file.current?.click()} className="rounded-lg p-2 text-mute hover:bg-ink/10 hover:text-ink" title="Upload data" aria-label="Upload data">
            <Icon name="paperclip-vertical" size={16} />
          </button>
          <input ref={file} type="file" multiple className="hidden" accept=".csv,.tsv,.xlsx,.xlsm,.xls,.json,.jsonl,.pdf,.txt,.md,.docx"
            onChange={async (e) => { if (e.target.files?.length) await upload([...e.target.files]); e.target.value = ""; }} />
          <textarea
            ref={area} rows={1} value={text} placeholder="Ask about your data…" aria-label="Message the copilot"
            onChange={(e) => {
              setText(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = `${Math.min(e.target.scrollHeight, 140)}px`;
            }}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
            className="max-h-36 min-h-9 flex-1 resize-none bg-transparent px-1.5 py-2 text-sm outline-none placeholder:text-mute"
          />
          <button onClick={submit} disabled={!text.trim() || busy} aria-label="Send"
            className="rounded-lg bg-accent p-2 text-on-accent transition enabled:hover:brightness-110 disabled:opacity-30">
            <Icon name="arrow-up" size={16} />
          </button>
        </div>
      </footer>
    </div>
  );
}
