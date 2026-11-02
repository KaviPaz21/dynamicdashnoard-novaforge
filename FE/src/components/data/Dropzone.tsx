"use client";

import { Icon } from "@/components/ui/Icon";
import { useRef, useState } from "react";
import { useApp } from "@/store/useApp";

const ACCEPT = ".csv,.tsv,.xlsx,.xlsm,.xls,.json,.jsonl,.pdf,.txt,.md,.docx";

export function Dropzone({ compact = false, onDone }: { compact?: boolean; onDone?: () => void }) {
  const upload = useApp((s) => s.upload);
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);

  const handle = async (list: FileList | null) => {
    if (!list || !list.length) return;
    setBusy(true);
    setProblems([]);
    try {
      const { rejected } = await upload([...list]);
      setProblems(rejected.map((r) => `${r.filename}: ${r.error}`));
      onDone?.();
    } catch (e) {
      setProblems([e instanceof Error ? e.message : String(e)]);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        onClick={() => input.current?.click()}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); handle(e.dataTransfer.files); }}
        className={`flex cursor-pointer items-center justify-center rounded-xl border border-dashed text-center transition ${compact ? "gap-3 px-4 py-4" : "flex-col gap-2 px-6 py-10"} ${over ? "border-accent bg-accent/10" : "border-line2 bg-panel/60 hover:border-accent/60 hover:bg-panel"}`}
      >
        {busy ? <Icon name="spinner" className="animate-spin text-accent" size={compact ? 20 : 28} /> : <Icon name="cloud-upload" className="text-accent" size={compact ? 20 : 28} />}
        <div className={compact ? "text-left" : ""}>
          <p className="text-sm font-medium text-ink">{busy ? "Uploading…" : "Drop files or click to upload"}</p>
          <p className="mt-0.5 text-xs text-mute">
            Tables: CSV, TSV, XLSX, JSON &nbsp;·&nbsp; Research: PDF, DOCX, TXT, MD
          </p>
        </div>
        <input ref={input} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => handle(e.target.files)} />
      </div>
      {problems.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs text-crit" role="alert">
          {problems.map((p) => <li key={p}>{p}</li>)}
        </ul>
      )}
    </div>
  );
}
