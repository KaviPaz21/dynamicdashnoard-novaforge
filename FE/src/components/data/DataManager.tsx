"use client";

import { Icon } from "@/components/ui/Icon";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { formatValue } from "@/lib/format";
import type { ColumnRole, Row, SourceDoc } from "@/lib/types";
import { useApp } from "@/store/useApp";
import { useToasts } from "@/store/useToasts";
import { Dropzone } from "./Dropzone";

const ROLE_DOT: Record<ColumnRole, string> = {
  measure: "var(--s1)", dimension: "var(--s2)", date: "var(--s4)",
  geo_lat: "var(--s3)", geo_lon: "var(--s3)", geo_country: "var(--s3)", geo_state: "var(--s3)", geo_city: "var(--s3)",
  id: "var(--mute)", text: "var(--mute)",
};

export const fmtBytes = (n: number) =>
  n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`;

function StatusBadge({ s }: { s: SourceDoc }) {
  if (s.status === "deleting")
    return <span className="inline-flex items-center gap-1.5 text-xs text-mute"><Icon name="spinner" size={13} className="animate-spin" /> Deleting…</span>;
  if (s.status === "ready")
    return <span className="inline-flex items-center gap-1 text-xs text-good"><Icon name="check-circle" size={13} /> Ready</span>;
  if (s.status === "failed")
    return <span className="inline-flex items-center gap-1 text-xs text-crit"><Icon name="exclamation" size={13} /> Failed</span>;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-warn">
      <Icon name="spinner" size={13} className="animate-spin" /> {s.stage}
    </span>
  );
}

export function SourceCard({ s, readOnly = false }: { s: SourceDoc; readOnly?: boolean }) {
  const removeSource = useApp((st) => st.removeSource);
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<{ columns: string[]; rows: Row[] } | null>(null);

  useEffect(() => {
    if (open && s.kind === "tabular" && s.status === "ready" && !preview) api.preview(s.id, 8).then(setPreview).catch(() => {});
  }, [open, s, preview]);

  const kindIcon = s.kind === "tabular" ? "table" : "document";
  return (
    <article className="rise card-surface rounded-[18px]">
      <div className="flex items-start gap-3 p-4">
        <div className="mt-0.5 rounded-lg bg-accent/12 p-2 text-accent"><Icon name={kindIcon} size={18} /></div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h3 className="truncate font-display text-base font-semibold">{s.name || s.filename}</h3>
            <StatusBadge s={s} />
            {s.conversation_id && (
              <span className="inline-flex items-center gap-1 rounded bg-accent/12 px-1.5 py-0.5 text-[11px] text-accent" title="Uploaded from a chat">
                <Icon name="paperclip-vertical" size={10} /> chat attachment
              </span>
            )}
          </div>
          <p className="truncate font-mono text-[11px] text-mute">
            {s.filename}{s.size_bytes ? ` · ${fmtBytes(s.size_bytes)}` : ""}
            {readOnly && s.owner_name ? ` · added by ${s.visibility === "global" ? s.owner_name : "you"}` : ""}
          </p>
          {s.description && <p className="mt-2 line-clamp-3 text-[13px] leading-relaxed text-ink2">{s.description}</p>}
          {s.error && <p className="mt-2 text-xs text-crit">{s.error}</p>}
          {s.warnings.map((w) => <p key={w} className="mt-1 text-xs text-warn">⚠ {w}</p>)}
          {s.status === "ready" && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-mute">
              {s.kind === "tabular" ? (
                <>
                  <span className="tabular rounded bg-ink/5 px-1.5 py-0.5 font-mono">{s.row_count.toLocaleString()} rows</span>
                  <span className="tabular rounded bg-ink/5 px-1.5 py-0.5 font-mono">{s.columns.length} columns</span>
                </>
              ) : (
                <>
                  <span className="tabular rounded bg-ink/5 px-1.5 py-0.5 font-mono">{s.chunk_count} chunks</span>
                  <span className="tabular rounded bg-ink/5 px-1.5 py-0.5 font-mono">{s.page_count} pages</span>
                  {s.topics.slice(0, 5).map((t) => <span key={t} className="rounded bg-accent/10 px-1.5 py-0.5 text-accent/90">{t}</span>)}
                </>
              )}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {s.kind === "tabular" && s.status === "ready" && (
            <button onClick={() => setOpen((o) => !o)} aria-expanded={open}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-ink2 hover:bg-ink/10">
              Schema <Icon name="angle-small-down" size={13} className={`transition ${open ? "rotate-180" : ""}`} />
            </button>
          )}
          {!readOnly && s.status !== "deleting" && (
            <button onClick={() => confirm(`Delete "${s.name || s.filename}" and its data? Visuals built on it are removed from your sheets.`) && removeSource(s.id)}
              className="rounded-md p-1.5 text-mute hover:bg-crit/15 hover:text-crit" title="Delete source" aria-label="Delete source">
              <Icon name="trash" size={15} />
            </button>
          )}
        </div>
      </div>

      {open && (
        <div className="space-y-4 border-t border-line p-4">
          <div className="overflow-x-auto rounded-md border border-line">
            <table className="w-full text-left text-[13px]">
              <thead className="bg-panel2 text-[11px] tracking-wide text-mute uppercase">
                <tr><th className="px-3 py-2">Column</th><th className="px-3 py-2">Type</th><th className="px-3 py-2">Role</th><th className="px-3 py-2 text-right">Distinct</th><th className="px-3 py-2">Description</th></tr>
              </thead>
              <tbody>
                {s.columns.map((c) => (
                  <tr key={c.name} className="border-t border-line align-top">
                    <td className="px-3 py-1.5 font-mono text-xs text-ink">{c.name}</td>
                    <td className="px-3 py-1.5 font-mono text-xs text-ink2">{c.dtype}</td>
                    <td className="px-3 py-1.5"><span className="inline-flex items-center gap-1.5 rounded bg-panel3 px-1.5 py-0.5 text-[11px] text-ink2">
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: ROLE_DOT[c.role] }} />
                      {c.role}
                    </span></td>
                    <td className="tabular px-3 py-1.5 text-right font-mono text-xs text-ink2">{c.distinct_count.toLocaleString()}</td>
                    <td className="px-3 py-1.5 text-xs text-mute">{c.description || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview && (
            <div className="overflow-x-auto rounded-md border border-line">
              <table className="w-full text-left text-xs">
                <thead className="bg-panel2 text-[11px] text-mute">
                  <tr>{preview.columns.map((c) => <th key={c} className="px-3 py-1.5 font-mono font-normal whitespace-nowrap">{c}</th>)}</tr>
                </thead>
                <tbody>
                  {preview.rows.map((r, i) => (
                    <tr key={i} className="border-t border-line">
                      {preview.columns.map((c) => <td key={c} className="px-3 py-1 font-mono whitespace-nowrap text-ink2">{formatValue(r[c])}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

function Relationships({ scope }: { scope: "private" | "global" }) {
  const sources = useApp((s) => s.sources);
  const allRels = useApp((s) => s.relationships);
  const refresh = useApp((s) => s.refreshSources);
  const name = (id: string) => sources.find((s) => s.id === id)?.name ?? id;
  const shown = new Set(sources.filter((s) => s.visibility === scope).map((s) => s.id));
  // private view: links touching your own tables; global view: links between global tables only
  const rels = allRels.filter((r) => (scope === "global" ? shown.has(r.from_source) && shown.has(r.to_source) : shown.has(r.from_source) || shown.has(r.to_source)));
  if (!rels.length) return null;
  return (
    <section className="card-surface rounded-[18px] p-4">
      <h3 className="mb-1 flex items-center gap-2 font-display text-base font-semibold"><Icon name="link" size={16} className="text-accent" /> Semantic model</h3>
      <p className="mb-3 text-xs text-mute">Filtering one table filters every related table, like a Power BI model.</p>
      <ul className="space-y-1.5">
        {rels.map((r) => (
          <li key={r.id} className="flex items-center gap-2 rounded-md bg-panel2 px-3 py-2 text-[13px]">
            <span className="min-w-0 flex-1 truncate"><b className="font-medium">{name(r.from_source)}</b><span className="font-mono text-xs text-ink2">.{r.from_column}</span>
              <span className="mx-2 text-accent">↔</span>
              <b className="font-medium">{name(r.to_source)}</b><span className="font-mono text-xs text-ink2">.{r.to_column}</span></span>
            <span className="rounded bg-ink/5 px-1.5 py-0.5 text-[10px] text-mute uppercase">{r.kind}</span>
            <button className="rounded p-1 text-mute hover:text-crit" aria-label="Remove relationship"
              onClick={async () => {
                try { await api.saveRelationships(allRels.filter((x) => x.id !== r.id)); } catch (e) { useToasts.getState().push(e instanceof Error ? e.message : "Could not remove the relationship", "error"); }
                refresh();
              }}>
              <Icon name="trash" size={13} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Manage one knowledge base: "private" = the signed-in user's local knowledge, "global" = shared with everyone (admins only). */
export function DataManager({ scope = "private", embedded = false }: { scope?: "private" | "global"; embedded?: boolean }) {
  const all = useApp((s) => s.sources);
  const sources = all.filter((s) => s.visibility === scope);
  const global = scope === "global";
  return (
    <div className={embedded ? "space-y-4" : "mx-auto max-w-4xl space-y-4 py-6"}>
      <div>
        <h2 className="flex items-center gap-2 font-display text-2xl font-semibold tracking-tight">
          <Icon name={global ? "globe" : "lock"} size={20} className="text-accent" />
          {global ? "Global knowledge" : "Local knowledge"}
        </h2>
        <p className="mt-1 text-sm text-ink2">
          {global
            ? "Files added here are visible to every user and are used by the copilot for everyone (unless they choose local only). "
            : "Only you can see these files. "}
          Tables are profiled and stored as queryable collections; documents are chunked and embedded for retrieval.
        </p>
      </div>
      <Dropzone visibility={scope} />
      <Relationships scope={scope} />
      <div className="space-y-3">
        {sources.map((s) => <SourceCard key={s.id} s={s} />)}
        {!sources.length && <p className="py-6 text-center text-sm text-mute">{global ? "No global knowledge yet." : "No data yet."}</p>}
      </div>
    </div>
  );
}
