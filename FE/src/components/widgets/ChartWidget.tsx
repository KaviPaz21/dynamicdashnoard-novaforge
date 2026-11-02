"use client";

import { useMemo } from "react";
import type { EChartsOption } from "echarts";
import { buildOption, clickableFields } from "@/lib/charts";
import type { QueryResult, Widget } from "@/lib/types";
import { useColors } from "@/hooks/useColors";
import { useCrossFilter } from "@/hooks/useCrossFilter";
import { useApp } from "@/store/useApp";
import { EChart } from "./EChart";

function clickedLabels(widget: Widget, option: EChartsOption, p: Record<string, unknown>): Record<string, string> {
  const fields = clickableFields(widget);
  const out: Record<string, string> = {};
  if (widget.type === "heatmap") {
    const v = p.value as number[];
    const xs = (option.xAxis as { data: string[] }).data;
    const ys = (option.yAxis as { data: string[] }).data;
    if (fields[0] && xs[v[0]] !== undefined) out[fields[0]] = xs[v[0]];
    if (fields[1] && ys[v[1]] !== undefined) out[fields[1]] = ys[v[1]];
  } else if (fields[0] && typeof p.name === "string") {
    out[fields[0]] = p.name;
  }
  return out;
}

export function ChartWidget({ widget, data }: { widget: Widget; data: QueryResult }) {
  const filters = useApp((s) => s.filters);
  const { selectedFor, toggle } = useCrossFilter(widget, data);
  const fields = clickableFields(widget);

  const selected = useMemo(() => {
    const set = new Set<string>();
    fields.forEach((f) => selectedFor(f).forEach((v) => set.add(v)));
    return set;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, widget]);

  const colors = useColors();
  const option = useMemo(() => buildOption({ widget, data, selected, colors }), [widget, data, selected, colors]);
  if (!option) return null;

  return (
    <EChart
      option={option}
      label={`${widget.title} (${widget.type} chart)`}
      onClick={
        fields.length
          ? (p) => Object.entries(clickedLabels(widget, option, p)).forEach(([field, label]) => toggle(field, label))
          : undefined
      }
    />
  );
}
