"use client";

import { useMemo } from "react";
import { formatValue, num, pretty, str } from "@/lib/format";
import type { QueryResult, Widget } from "@/lib/types";
import { useCrossFilter } from "@/hooks/useCrossFilter";

const uniq = <T,>(xs: T[]) => [...new Set(xs)];

export function MatrixWidget({ widget, data }: { widget: Widget; data: QueryResult }) {
  const { rows: rowKey, columns: colKey, value: valKey } = widget.encoding;
  const { selectedFor, toggle } = useCrossFilter(widget, data);

  const model = useMemo(() => {
    const rowVals = uniq(data.rows.map((r) => str(r[rowKey!])));
    const colVals = colKey ? uniq(data.rows.map((r) => str(r[colKey]))) : [];
    const cell = new Map<string, number | null>();
    for (const r of data.rows) cell.set(`${str(r[rowKey!])}\u0000${colKey ? str(r[colKey]) : ""}`, num(r[valKey!]));
    const all = [...cell.values()].filter((v): v is number => v !== null);
    const additive = ["sum", "count"].includes(widget.query?.measures.find((m) => m.alias === valKey)?.agg ?? "");
    return { rowVals, colVals, cell, max: Math.max(1e-9, ...all.map(Math.abs)), additive };
  }, [data.rows, rowKey, colKey, valKey, widget.query]);

  if (!rowKey || !valKey) return null;
  const fmt = (v: number | null) => formatValue(v, widget.options);
  const selRows = selectedFor(rowKey);
  const selCols = selectedFor(colKey);
  const rowTotal = (r: string) =>
    model.colVals.length
      ? model.colVals.reduce((s, c) => s + (model.cell.get(`${r}\u0000${c}`) ?? 0), 0)
      : (model.cell.get(`${r}\u0000`) ?? 0);
  const colTotal = (c: string) => model.rowVals.reduce((s, r) => s + (model.cell.get(`${r}\u0000${c}`) ?? 0), 0);
  const grand = model.rowVals.reduce((s, r) => s + rowTotal(r), 0);

  const head = "border-b border-line2 bg-panel2 px-3 py-2 text-[11px] font-medium tracking-wide text-mute uppercase";
  const clickable = widget.cross_filter ? "cursor-pointer hover:text-ink" : "";

  return (
    <div className="h-full overflow-auto rounded-md border border-line">
      <table className="w-full border-collapse text-[13px]">
        <thead className="sticky top-0 z-10">
          <tr>
            <th className={`${head} text-left`}>{pretty(rowKey)}</th>
            {model.colVals.map((c) => (
              <th
                key={c}
                className={`${head} text-right whitespace-nowrap ${clickable} ${selCols.has(c) ? "text-accent" : ""}`}
                onClick={() => colKey && toggle(colKey, c)}
              >
                {c}
              </th>
            ))}
            {!model.colVals.length && <th className={`${head} text-right`}>{pretty(valKey)}</th>}
            {model.additive && model.colVals.length > 0 && <th className={`${head} text-right`}>Total</th>}
          </tr>
        </thead>
        <tbody>
          {model.rowVals.map((r) => (
            <tr key={r} className="border-b border-line last:border-0">
              <th
                scope="row"
                className={`px-3 py-1.5 text-left font-normal text-ink2 whitespace-nowrap ${clickable} ${selRows.has(r) ? "text-accent" : ""}`}
                onClick={() => toggle(rowKey, r)}
              >
                {r}
              </th>
              {(model.colVals.length ? model.colVals : [""]).map((c) => {
                const v = model.cell.get(`${r}\u0000${c}`) ?? null;
                const a = v === null ? 0 : Math.min(0.75, (Math.abs(v) / model.max) * 0.75);
                return (
                  <td
                    key={c}
                    className="tabular px-3 py-1.5 text-right font-mono text-ink"
                    style={{ background: `color-mix(in srgb, var(--accent) ${(a * 100).toFixed(1)}%, transparent)` }}
                    onClick={() => {
                      toggle(rowKey, r);
                      if (colKey && c) toggle(colKey, c);
                    }}
                  >
                    {fmt(v)}
                  </td>
                );
              })}
              {model.additive && model.colVals.length > 0 && (
                <td className="tabular px-3 py-1.5 text-right font-mono font-medium text-ink">{fmt(rowTotal(r))}</td>
              )}
            </tr>
          ))}
        </tbody>
        {model.additive && model.colVals.length > 0 && (
          <tfoot className="sticky bottom-0">
            <tr>
              <th className="border-t border-line2 bg-panel2 px-3 py-2 text-left text-[11px] font-medium text-mute uppercase">Total</th>
              {model.colVals.map((c) => (
                <td key={c} className="tabular border-t border-line2 bg-panel2 px-3 py-2 text-right font-mono font-medium">
                  {fmt(colTotal(c))}
                </td>
              ))}
              <td className="tabular border-t border-line2 bg-panel2 px-3 py-2 text-right font-mono font-medium">{fmt(grand)}</td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
