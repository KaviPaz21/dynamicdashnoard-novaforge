"use client";

import { Icon } from "@/components/ui/Icon";
import { useMemo, useState } from "react";
import { useWidgetData } from "@/hooks/useWidgetData";
import { str } from "@/lib/format";
import type { QuerySpec, Widget } from "@/lib/types";
import { useApp } from "@/store/useApp";

export function SlicerWidget({ widget }: { widget: Widget }) {
  const column = widget.slicer_column ?? "";
  const sourceId = widget.source_id ?? "";
  const mode = widget.slicer_mode ?? "dropdown";
  const filters = useApp((s) => s.filters);
  const setFilter = useApp((s) => s.setFilter);
  const removeFilter = useApp((s) => s.removeFilter);
  const toggleValue = useApp((s) => s.toggleValue);
  const [search, setSearch] = useState("");

  const isRange = mode === "range" || mode === "date_range";
  const spec = useMemo<QuerySpec>(
    () =>
      isRange
        ? {
            source_id: sourceId, dimensions: [], select: [], filters: [], sort: [],
            measures: [
              { column, agg: "min", alias: "lo" },
              { column, agg: "max", alias: "hi" },
            ],
          }
        : {
            source_id: sourceId, dimensions: [{ column }], select: [], filters: [], limit: 500,
            measures: [{ column: null, agg: "count", alias: "n" }],
            sort: [{ by: column, dir: "asc" }],
          },
    [isRange, sourceId, column],
  );
  const { data, loading } = useWidgetData(widget, { spec });
  const mine = filters.find((f) => f.origin_widget_id === widget.id && f.column === column);
  const chosen = new Set<string>((Array.isArray(mine?.value) ? mine!.value : mine ? [mine.value] : []).map(String));
  const base = { source_id: sourceId, column, origin_widget_id: widget.id };

  if (loading && !data) return <div className="skeleton h-full min-h-10" />;

  if (isRange) {
    const lo = data?.rows[0]?.lo;
    const hi = data?.rows[0]?.hi;
    const cur = Array.isArray(mine?.value) ? (mine!.value as unknown[]) : [lo, hi];
    const type = mode === "date_range" ? "date" : "number";
    const apply = (a: unknown, b: unknown) => {
      if (a === "" || b === "" || (String(a) === String(lo) && String(b) === String(hi))) removeFilter(widget.id, column);
      else setFilter({ ...base, op: "between", value: [type === "number" ? Number(a) : a, type === "number" ? Number(b) : b] });
    };
    const field = "w-full rounded-md border border-line2 bg-panel2 px-2 py-1.5 font-mono text-xs text-ink outline-none focus:border-accent";
    return (
      <div className="flex h-full flex-col justify-center gap-2" key={JSON.stringify(mine?.value ?? null)}>
        <label className="text-[11px] text-mute">
          From
          <input type={type} className={field} defaultValue={String(cur[0] ?? "")} min={String(lo ?? "")} max={String(hi ?? "")}
            onBlur={(e) => apply(e.target.value, cur[1] ?? hi)} />
        </label>
        <label className="text-[11px] text-mute">
          To
          <input type={type} className={field} defaultValue={String(cur[1] ?? "")} min={String(lo ?? "")} max={String(hi ?? "")}
            onBlur={(e) => apply(cur[0] ?? lo, e.target.value)} />
        </label>
      </div>
    );
  }

  const options = (data?.rows ?? []).map((r) => ({ value: r[column], label: str(r[column]), n: Number(r.n ?? 0) }));

  if (mode === "dropdown") {
    return (
      <div className="flex h-full items-center">
        <select
          aria-label={widget.title}
          className="w-full rounded-md border border-line2 bg-panel2 px-2.5 py-2 text-sm text-ink outline-none focus:border-accent"
          value={chosen.size ? [...chosen][0] : ""}
          onChange={(e) => {
            const opt = options.find((o) => String(o.value) === e.target.value);
            if (!opt) removeFilter(widget.id, column);
            else setFilter({ ...base, op: "in", value: [opt.value] });
          }}
        >
          <option value="">All</option>
          {options.map((o) => (
            <option key={o.label} value={String(o.value)}>{o.label} ({o.n.toLocaleString()})</option>
          ))}
        </select>
      </div>
    );
  }

  const shown = options.filter((o) => o.label.toLowerCase().includes(search.toLowerCase()));
  return (
    <div className="flex h-full min-h-0 flex-col gap-1.5">
      {options.length > 8 && (
        <div className="flex items-center gap-1.5 rounded-md border border-line2 bg-panel2 px-2">
          <Icon name="search" size={12} className="text-mute" />
          <input
            value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search"
            className="w-full bg-transparent py-1.5 text-xs outline-none placeholder:text-mute"
          />
        </div>
      )}
      <ul className="min-h-0 flex-1 space-y-0.5 overflow-auto pr-1">
        {shown.map((o) => {
          const on = chosen.has(String(o.value));
          return (
            <li key={o.label}>
              <label className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-[13px] hover:bg-ink/5">
                <input type="checkbox" className="accent-accent" checked={on}
                  onChange={() => toggleValue({ ...base, value: o.value })} />
                <span className={`min-w-0 flex-1 truncate ${on ? "text-ink" : "text-ink2"}`}>{o.label}</span>
                <span className="tabular font-mono text-[11px] text-mute">{o.n.toLocaleString()}</span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
