"use client";

import { Icon } from "@/components/ui/Icon";
import dynamic from "next/dynamic";
import { useState } from "react";
import { useWidgetData } from "@/hooks/useWidgetData";
import type { Encoding, Widget, WidgetType } from "@/lib/types";
import { useApp } from "@/store/useApp";
import { CardWidget } from "../widgets/CardWidget";
import { IconBadge } from "../widgets/IconBadge";
import { ChartWidget } from "../widgets/ChartWidget";
import { InsightWidget } from "../widgets/InsightWidget";
import { MatrixWidget } from "../widgets/MatrixWidget";
import { SlicerWidget } from "../widgets/SlicerWidget";
import { TableWidget } from "../widgets/TableWidget";

const MapWidget = dynamic(() => import("../widgets/MapWidget"), {
  ssr: false,
  loading: () => <div className="skeleton h-full" />,
});

const CARTESIAN: WidgetType[] = ["column", "bar", "stacked_column", "stacked_bar", "line", "area"];
const SHARE: WidgetType[] = ["pie", "donut", "treemap", "funnel"];
const LABELS: Record<string, string> = {
  column: "Column", bar: "Bar", stacked_column: "Stacked column", stacked_bar: "Stacked bar", line: "Line",
  area: "Area", pie: "Pie", donut: "Donut", treemap: "Treemap", funnel: "Funnel",
};

function alternatives(w: Widget): WidgetType[] {
  if (CARTESIAN.includes(w.type) || SHARE.includes(w.type)) {
    const single = (w.encoding.y?.length ?? 0) <= 1;
    return [...CARTESIAN, ...(single ? SHARE : [])];
  }
  return [];
}

function convert(from: WidgetType, to: WidgetType, e: Encoding): Encoding {
  const fromShare = SHARE.includes(from);
  const toShare = SHARE.includes(to);
  if (fromShare && !toShare) return { ...e, x: e.category, y: e.value ? [e.value] : [] };
  if (!fromShare && toShare) return { ...e, category: e.x, value: e.y?.[0] ?? null };
  return e;
}

const NO_DATA_TYPES: WidgetType[] = ["slicer", "insight"];

function Body({ widget, asTable }: { widget: Widget; asTable: boolean }) {
  const { data, loading, error } = useWidgetData(widget);

  if (widget.type === "insight") return <InsightWidget widget={widget} />;
  if (widget.type === "slicer") return <SlicerWidget widget={widget} />;
  if (loading && !data) return <div className="skeleton h-full min-h-12" />;
  if (error)
    return (
      <div className="flex h-full items-center gap-2 text-sm text-ink2">
        <Icon name="triangle-warning" size={16} className="shrink-0 text-warn" />
        <span className="line-clamp-4">{error}</span>
      </div>
    );
  if (!data || !data.rows.length)
    return <div className="flex h-full items-center justify-center text-sm text-mute">No data for the current filters</div>;

  if (asTable && widget.type !== "table") return <TableWidget widget={widget} data={data} />;
  switch (widget.type) {
    case "card": return <CardWidget widget={widget} data={data} />;
    case "table": return <TableWidget widget={widget} data={data} />;
    case "matrix": return <MatrixWidget widget={widget} data={data} />;
    case "map": return <MapWidget widget={widget} data={data} />;
    default: return <ChartWidget widget={widget} data={data} />;
  }
}

export function WidgetFrame({ widget, expanded = false }: { widget: Widget; expanded?: boolean }) {
  const removeWidget = useApp((s) => s.removeWidget);
  const updateWidget = useApp((s) => s.updateWidget);
  const expandWidget = useApp((s) => s.expandWidget);
  const [asTable, setAsTable] = useState(false);
  const alts = alternatives(widget);
  const isCard = widget.type === "card";
  const canTable = !NO_DATA_TYPES.includes(widget.type) && widget.type !== "table" && !isCard;

  const btn = "rounded p-1 text-mute transition hover:bg-ink/10 hover:text-ink focus-visible:outline-2 focus-visible:outline-accent";

  return (
    <section
      className={`group tile flex h-full w-full min-h-0 flex-col card-surface rounded-[18px] border border-transparent px-4 pt-3 pb-3.5 ${widget.type === "insight" ? "border-l-[3px] border-l-accent" : ""}`}
      aria-label={widget.title}
    >
      <header className={`${expanded ? "" : "tile-drag cursor-grab active:cursor-grabbing"} mb-1.5 flex min-h-6 items-center ${isCard ? "gap-2.5" : "gap-1"}`}>
        {isCard ? (
          <IconBadge widget={widget} />
        ) : (
          !expanded && <Icon name="menu-dots-vertical" size={14} className="-ml-1.5 shrink-0 text-mute opacity-0 transition group-hover:opacity-70" aria-hidden />
        )}
        <div className="min-w-0 flex-1">
          <h3
            className={`truncate ${isCard ? "text-xs font-medium text-ink2" : "text-[13px] font-semibold text-ink"}`}
            title={widget.title}
          >
            {widget.title}
          </h3>
          {widget.subtitle && !isCard && <p className="-mt-0.5 truncate text-[11px] text-mute">{widget.subtitle}</p>}
        </div>
        <div className="no-drag flex shrink-0 items-center gap-0.5 opacity-0 transition group-focus-within:opacity-100 group-hover:opacity-100">
          {alts.length > 0 && (
            <select
              aria-label="Visual type"
              value={widget.type}
              onChange={(e) => {
                const to = e.target.value as WidgetType;
                updateWidget(widget.id, { type: to, encoding: convert(widget.type, to, widget.encoding) });
              }}
              className="max-w-24 rounded bg-transparent px-1 py-0.5 text-[11px] text-mute outline-none hover:bg-ink/10 hover:text-ink"
            >
              {(alts.includes(widget.type) ? alts : [widget.type, ...alts]).map((t) => (
                <option key={t} value={t}>{LABELS[t] ?? t}</option>
              ))}
            </select>
          )}
          {canTable && (
            <button className={`${btn} ${asTable ? "text-accent" : ""}`} onClick={() => setAsTable((v) => !v)} aria-pressed={asTable} title="View as table">
              <Icon name="table" size={14} />
            </button>
          )}
          <button className={btn} onClick={() => expandWidget(expanded ? null : widget.id)} title={expanded ? "Close" : "Focus mode"}>
            {expanded ? <Icon name="compress" size={14} /> : <Icon name="expand" size={14} />}
          </button>
          <button className={btn} onClick={() => removeWidget(widget.id)} title="Remove from dashboard">
            <Icon name="cross-small" size={14} />
          </button>
        </div>
      </header>
      <div className="no-drag min-h-0 flex-1">
        <Body widget={widget} asTable={asTable} />
      </div>
    </section>
  );
}
