"use client";

import { useMemo } from "react";
import type { EChartsOption } from "echarts";
import { Icon } from "@/components/ui/Icon";
import { useColors } from "@/hooks/useColors";
import { useSize } from "@/hooks/useSize";
import { useWidgetData } from "@/hooks/useWidgetData";
import { formatValue, num, str } from "@/lib/format";
import { withAlpha } from "@/lib/palette";
import type { QueryResult, Widget } from "@/lib/types";
import { EChart } from "./EChart";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function periodChange(values: (number | null)[]) {
  const pts = values.filter((v): v is number => v !== null);
  if (pts.length < 2) return null;
  const last = pts[pts.length - 1];
  const prev = pts[pts.length - 2];
  if (prev === 0) return null;
  return (last - prev) / Math.abs(prev);
}

export function CardWidget({ widget, data }: { widget: Widget; data: QueryResult }) {
  const { ref, w, h } = useSize<HTMLDivElement>();
  const c = useColors();
  const trend = useWidgetData(widget, { spec: widget.trend ?? null, initial: widget.trend_data }).data;

  const raw = data.rows[0]?.[widget.encoding.value ?? ""];
  const empty = num(raw) === null && typeof raw !== "string";
  const text = empty ? "—" : formatValue(raw, widget.options);

  const xKey = widget.trend?.dimensions[0] && (widget.trend.dimensions[0].alias || widget.trend.dimensions[0].column);
  const yKey = widget.trend?.measures[0]?.alias;
  const series = useMemo(
    () => (trend && xKey && yKey ? trend.rows.map((r) => ({ x: str(r[xKey]), y: num(r[yKey]) })) : []),
    [trend, xKey, yKey],
  );
  const change = periodChange(series.map((p) => p.y));
  const bucket = widget.trend?.dimensions[0]?.bucket;

  const fontSize = clamp(Math.min(h * 0.4, (w * 0.92) / Math.max(text.length * 0.62, 3)), 22, 72);
  const showSpark = series.length > 2 && h >= 88;

  const option = useMemo<EChartsOption>(
    () => ({
      backgroundColor: "transparent",
      grid: { left: 0, right: 0, top: 4, bottom: 0 },
      xAxis: { type: "category", show: false, data: series.map((p) => p.x), boundaryGap: false },
      yAxis: { type: "value", show: false, scale: true },
      tooltip: {
        trigger: "axis", confine: true, backgroundColor: c.ink.tooltip, borderColor: c.ink.axis,
        textStyle: { color: c.ink.primary, fontSize: 11 }, padding: [4, 8],
        valueFormatter: (v) => formatValue(v as number, widget.options),
      },
      series: [
        {
          type: "line", data: series.map((p) => p.y), smooth: 0.25, showSymbol: false,
          lineStyle: { width: 2, color: c.accentFill },
          areaStyle: { color: { type: "linear", x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: withAlpha(c.accentFill, 0.32) }, { offset: 1, color: withAlpha(c.accentFill, 0) }] } },
        },
      ],
    }),
    [series, widget.options, c],
  );

  const up = change !== null && change > 0.0005;
  const down = change !== null && change < -0.0005;
  const arrow = up ? "arrow-trend-up" : down ? "arrow-trend-down" : "minus";

  return (
    <div ref={ref} className="relative h-full min-h-0">
      {showSpark && (
        <div className="absolute inset-x-0 bottom-0" style={{ height: "44%" }}>
          <EChart option={option} label={`${widget.title} trend`} />
        </div>
      )}
      <div className="pointer-events-none relative">
        <div
          className="font-display tabular leading-none font-semibold tracking-tight whitespace-nowrap text-ink"
          style={{ fontSize }}
          title={String(raw ?? "")}
        >
          {text}
        </div>
        {change !== null && (
          <div className="mt-2 flex items-center gap-1.5 text-xs">
            <span
              className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-medium ${up ? "bg-chip-good text-chip-good-fg" : down ? "bg-chip-bad text-chip-bad-fg" : "bg-ink/10 text-ink2"}`}
            >
              <Icon name={arrow} size={12} />
              {Math.abs(change * 100).toFixed(Math.abs(change) < 0.1 ? 1 : 0)}%
            </span>
            <span className="truncate text-mute">vs previous {bucket ?? "period"}</span>
          </div>
        )}
        {!change && widget.subtitle && <div className="mt-2 truncate text-xs text-mute">{widget.subtitle}</div>}
      </div>
    </div>
  );
}
