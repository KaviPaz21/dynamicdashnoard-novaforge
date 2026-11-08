"use client";

import { useEffect, useMemo } from "react";
import { starterQuestions } from "@/lib/suggestions";
import ReactGridLayout, { useContainerWidth, verticalCompactor, type LayoutItem } from "react-grid-layout";
import type { Widget, WidgetType } from "@/lib/types";
import { useApp } from "@/store/useApp";
import { Dropzone } from "../data/Dropzone";
import { WidgetFrame } from "./WidgetFrame";

export const ROW_HEIGHT = 72;

const MIN_SIZE: Partial<Record<WidgetType, [number, number]>> = {
  card: [2, 2], gauge: [2, 2], slicer: [2, 2], insight: [3, 2], table: [4, 3], matrix: [4, 3], map: [3, 3],
};
const minOf = (t: WidgetType): [number, number] => MIN_SIZE[t] ?? [3, 3];

function EmptyState() {
  const sources = useApp((s) => s.sources);
  const send = useApp((s) => s.send);
  const busy = useApp((s) => s.busy);
  const ready = sources.some((s) => s.status === "ready" && !s.conversation_id);
  const starters = useMemo(() => starterQuestions(sources), [sources]);
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center pt-[7vh] text-center">
      <div className="rise mb-5 rounded-2xl border border-accent/30 bg-accent/10 px-3 py-1 font-mono text-[11px] tracking-[0.2em] text-accent uppercase">
        Fire safety · microgravity
      </div>
      <h2 className="rise font-display text-4xl leading-[1.05] font-semibold tracking-tight [animation-delay:60ms] md:text-5xl">
        {ready ? "Ask, and the dashboard builds itself." : "Bring the data. We’ll bring the dashboard."}
      </h2>
      <p className="rise mt-4 max-w-lg text-[15px] leading-relaxed text-ink2 [animation-delay:120ms]">
        {ready
          ? "Describe what you want to see or understand. The copilot picks the KPIs, charts and maps, and every visual stays cross-filterable."
          : "Upload experiment tables and research papers. Tables become queryable collections; papers become a searchable knowledge base."}
      </p>
      <div className="rise mt-8 w-full [animation-delay:180ms]">
        {ready ? (
          <div className="grid gap-2 sm:grid-cols-2" aria-label="Suggested questions">
            {starters.map((s) => (
              <button key={s} disabled={busy} onClick={() => send(s)}
                className="rounded-xl border border-line bg-panel px-4 py-3 text-left text-sm text-ink2 transition hover:border-accent/50 hover:text-ink disabled:opacity-50">
                {s}
              </button>
            ))}
          </div>
        ) : (
          <Dropzone />
        )}
      </div>
    </div>
  );
}

function Grid({ widgets }: { widgets: Widget[] }) {
  const { width, containerRef, mounted } = useContainerWidth();
  const setLayouts = useApp((s) => s.setLayouts);
  const layout = useMemo<LayoutItem[]>(
    () =>
      widgets.map((w) => {
        const [minW, minH] = minOf(w.type);
        return { i: w.id, x: w.layout.x ?? 0, y: w.layout.y ?? 0, w: w.layout.w, h: w.layout.h, minW, minH };
      }),
    [widgets],
  );

  return (
    <div ref={containerRef}>
      {mounted && (
        <ReactGridLayout
          width={width}
          layout={layout}
          gridConfig={{ cols: 12, rowHeight: ROW_HEIGHT, margin: [12, 12], containerPadding: [0, 0] }}
          dragConfig={{ enabled: true, handle: ".tile-drag", cancel: ".no-drag" }}
          resizeConfig={{ enabled: true, handles: ["se"] }}
          compactor={verticalCompactor}
          onLayoutChange={(next) =>
            setLayouts(next.map((l) => ({ id: l.i, layout: { x: l.x, y: l.y, w: l.w, h: l.h } })))
          }
        >
          {widgets.map((w) => (
            <div key={w.id}>
              <WidgetFrame widget={w} />
            </div>
          ))}
        </ReactGridLayout>
      )}
    </div>
  );
}

export function DashboardCanvas() {
  const widgets = useApp((s) => s.dashboard.widgets);
  const expanded = useApp((s) => s.expandedWidgetId);
  const expandWidget = useApp((s) => s.expandWidget);
  const focus = widgets.find((w) => w.id === expanded);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && expandWidget(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded, expandWidget]);

  if (!widgets.length) return <EmptyState />;

  return (
    <div className="py-4">
      <Grid widgets={widgets} />

      {focus && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm" onClick={() => expandWidget(null)}>
          <div className="h-full max-h-[780px] w-full max-w-6xl" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={focus.title}>
            <WidgetFrame widget={focus} expanded />
          </div>
        </div>
      )}
    </div>
  );
}
