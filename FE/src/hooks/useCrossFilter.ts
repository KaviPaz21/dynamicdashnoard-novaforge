"use client";

import { bucketRange, dimensionSource, valuesOf } from "@/lib/filters";
import type { QueryResult, Widget } from "@/lib/types";
import { useApp } from "@/store/useApp";

export function useCrossFilter(widget: Widget, data: QueryResult) {
  const filters = useApp((s) => s.filters);
  const toggleValue = useApp((s) => s.toggleValue);
  const setFilter = useApp((s) => s.setFilter);
  const removeFilter = useApp((s) => s.removeFilter);

  const selectedFor = (field: string | null | undefined): Set<string> => {
    const src = dimensionSource(widget, field);
    return src ? valuesOf(filters, widget.id, src.column) : new Set();
  };

  const toggle = (field: string, label: string) => {
    if (!widget.cross_filter || !widget.source_id || label === "(blank)") return;
    const src = dimensionSource(widget, field);
    if (!src) return;
    if (src.bucket) {
      const range = bucketRange(src.bucket, label);
      if (!range) return;
      if (valuesOf(filters, widget.id, src.column).has(label)) removeFilter(widget.id, src.column);
      else
        setFilter({
          source_id: widget.source_id, column: src.column, op: "between", value: range,
          origin_widget_id: widget.id, label,
        });
      return;
    }
    const raw = data.rows.find((r) => String(r[field]) === label)?.[field] ?? label;
    toggleValue({ source_id: widget.source_id, column: src.column, origin_widget_id: widget.id, value: raw });
  };

  return { selectedFor, toggle };
}
