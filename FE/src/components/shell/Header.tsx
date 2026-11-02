"use client";

import { Icon } from "@/components/ui/Icon";
import { useState } from "react";
import { describeFilter } from "@/lib/filters";
import { useApp } from "@/store/useApp";

function SaveButton() {
  const activeId = useApp((s) => s.activeSheetId);
  const widgets = useApp((s) => s.dashboard.widgets);
  const title = useApp((s) => s.dashboard.title);
  const dirty = useApp((s) => s.dirty);
  const saveState = useApp((s) => s.saveState);
  const savedAt = useApp((s) => s.savedAt);
  const saveNow = useApp((s) => s.saveNow);
  const createSheet = useApp((s) => s.createSheet);

  const nothing = !activeId && widgets.length === 0;
  const saving = saveState === "saving";
  const failed = saveState === "error";
  const unsaved = dirty || failed || (!activeId && widgets.length > 0);
  const time = savedAt ? new Date(savedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : null;

  const onClick = () => (activeId ? saveNow() : createSheet(title || undefined, widgets));
  const status = saving ? "Saving…" : failed ? "Not saved - retry" : unsaved ? "Unsaved changes" : time ? `Saved ${time}` : "All changes saved";

  return (
    <div className="flex items-center gap-3">
      <span
        className={`hidden text-xs sm:inline ${failed ? "text-warn" : unsaved && !saving ? "text-ink2" : "text-mute"}`}
        role="status" aria-live="polite"
      >
        {status}
      </span>
      <button
        onClick={onClick}
        disabled={nothing || saving}
        title={nothing ? "Nothing to save yet" : "Save this sheet (Ctrl+S)"}
        aria-label="Save sheet"
        className={`inline-flex items-center gap-2 rounded-lg border px-3.5 py-2 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45 ${
          unsaved && !nothing
            ? "border-accent bg-accent text-on-accent shadow-sm hover:brightness-110"
            : "card-surface border-transparent text-ink2 hover:text-ink"
        }`}
      >
        {saving ? <Icon name="spinner" size={16} className="animate-spin" /> : failed ? <Icon name="exclamation" size={16} /> : <Icon name="disk" size={16} />}
        Save
        {!unsaved && !saving && !nothing && <Icon name="check" size={14} className="text-good-fg" aria-hidden />}
      </button>
    </div>
  );
}

function Filters() {
  const filters = useApp((s) => s.filters);
  const widgets = useApp((s) => s.dashboard.widgets);
  const removeFilter = useApp((s) => s.removeFilter);
  const clearFilters = useApp((s) => s.clearFilters);

  if (!filters.length)
    return (
      <p className="flex items-center gap-1.5 text-xs text-mute">
        <Icon name="cursor-finger" size={13} /> No filters applied. Click a bar, slice, cell or map region to cross-filter this sheet.
      </p>
    );
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5" role="region" aria-label="Filters applied on this sheet">
      <span className="mr-1 font-mono text-[10px] tracking-[0.14em] text-mute uppercase">Filters</span>
      {filters.map((f) => {
        const origin = widgets.find((w) => w.id === f.origin_widget_id)?.title;
        return (
          <span
            key={`${f.origin_widget_id}-${f.column}`} title={origin ? `from “${origin}”` : undefined}
            className="inline-flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent/10 py-0.5 pr-1 pl-2.5 text-xs text-ink"
          >
            {describeFilter(f)}
            <button
              onClick={() => removeFilter(f.origin_widget_id, f.column)} aria-label={`Remove filter ${f.column}`}
              className="rounded-full p-0.5 hover:bg-ink/15"
            >
              <Icon name="cross-small" size={12} />
            </button>
          </span>
        );
      })}
      <button onClick={clearFilters} className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs text-ink2 hover:bg-ink/10 hover:text-ink">
        <Icon name="filter-slash" size={12} /> Clear all
      </button>
    </div>
  );
}

function SheetHeader() {
  const title = useApp((s) => s.dashboard.title);
  const count = useApp((s) => s.dashboard.widgets.length);
  const activeId = useApp((s) => s.activeSheetId);
  const renameSheet = useApp((s) => s.renameSheet);
  const clearWidgets = useApp((s) => s.clearWidgets);
  const [editing, setEditing] = useState(false);

  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="font-mono text-[10px] tracking-[0.14em] text-mute uppercase">Dashboard sheet</div>
          {editing ? (
            <input
              autoFocus defaultValue={title} aria-label="Sheet name"
              onBlur={(e) => { renameSheet(e.target.value); setEditing(false); }}
              onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") setEditing(false); }}
              className="w-full max-w-lg rounded-md border border-accent/60 bg-panel2 px-2 py-0.5 font-display text-xl font-semibold outline-none"
            />
          ) : (
            <h1
              onClick={() => activeId && setEditing(true)}
              title={activeId ? "Click to rename" : undefined}
              className={`truncate font-display text-xl leading-tight font-semibold tracking-tight ${activeId ? "cursor-text hover:text-ink2" : ""}`}
            >
              {title || (activeId ? "Sheet" : "No sheet open")}
            </h1>
          )}
          <div className="font-mono text-[11px] text-mute">{count} visual{count === 1 ? "" : "s"}</div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {count > 0 && (
            <button
              onClick={() => confirm("Remove every visual from this sheet?") && clearWidgets()}
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs text-mute transition hover:bg-ink/10 hover:text-ink"
              title="Remove every visual from this sheet"
            >
              <Icon name="trash" size={14} /> Clear
            </button>
          )}
          <SaveButton />
        </div>
      </div>
      <div className="mt-2.5 min-h-6">
        <Filters />
      </div>
    </>
  );
}

export function Header() {
  const tab = useApp((s) => s.tab);
  return (
    <header className="px-3 pt-1 pb-3">
      {tab === "dashboard" ? (
        <SheetHeader />
      ) : (
        <div>
          <div className="font-mono text-[10px] tracking-[0.14em] text-mute uppercase">Library</div>
          <h1 className="font-display text-xl leading-tight font-semibold tracking-tight">Data</h1>
          <p className="mt-0.5 text-xs text-mute">Tables become queryable collections; documents become a searchable knowledge base.</p>
        </div>
      )}
    </header>
  );
}
