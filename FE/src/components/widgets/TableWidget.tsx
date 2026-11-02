"use client";

import { Icon } from "@/components/ui/Icon";
import { useMemo, useState } from "react";
import { formatValue, pretty } from "@/lib/format";
import type { QueryResult, Widget } from "@/lib/types";

const NUMERIC = new Set(["integer", "float"]);

export function TableWidget({ widget, data }: { widget: Widget; data: QueryResult }) {
  const [sort, setSort] = useState<{ col: string; dir: 1 | -1 } | null>(null);

  const rows = useMemo(() => {
    if (!sort) return data.rows;
    return [...data.rows].sort((a, b) => {
      const x = a[sort.col];
      const y = b[sort.col];
      if (x === y) return 0;
      if (x === null || x === undefined) return 1;
      if (y === null || y === undefined) return -1;
      return (x < y ? -1 : 1) * sort.dir;
    });
  }, [data.rows, sort]);

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-auto rounded-md border border-line">
        <table className="w-full border-collapse text-[13px]">
          <thead className="sticky top-0 z-10 bg-panel2">
            <tr>
              {data.columns.map((c) => {
                const active = sort?.col === c.name;
                return (
                  <th
                    key={c.name}
                    scope="col"
                    aria-sort={active ? (sort!.dir === 1 ? "ascending" : "descending") : "none"}
                    className={`cursor-pointer select-none whitespace-nowrap border-b border-line2 px-3 py-2 text-[11px] font-medium tracking-wide text-mute uppercase hover:text-ink ${NUMERIC.has(c.dtype) ? "text-right" : "text-left"}`}
                    onClick={() => setSort(active && sort!.dir === -1 ? null : { col: c.name, dir: active ? -1 : 1 })}
                  >
                    <span className="inline-flex items-center gap-1">
                      {pretty(c.name)}
                      {active && (sort!.dir === 1 ? <Icon name="arrow-small-up" size={11} /> : <Icon name="arrow-small-down" size={11} />)}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-line last:border-0 hover:bg-ink/[0.03]">
                {data.columns.map((c) => (
                  <td
                    key={c.name}
                    className={`max-w-[260px] truncate px-3 py-1.5 ${NUMERIC.has(c.dtype) ? "tabular text-right font-mono text-ink" : "text-ink2"}`}
                    title={String(r[c.name] ?? "")}
                  >
                    {formatValue(r[c.name], NUMERIC.has(c.dtype) ? widget.options : {})}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="pt-1.5 text-[11px] text-mute">
        {data.rows.length.toLocaleString()} of {data.total_rows.toLocaleString()} rows
      </div>
    </div>
  );
}
