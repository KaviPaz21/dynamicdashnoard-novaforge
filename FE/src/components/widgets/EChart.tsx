"use client";

import { useEffect, useRef } from "react";
import type { ECharts, EChartsOption } from "echarts";

interface Props {
  option: EChartsOption;
  onClick?: (params: Record<string, unknown>) => void;
  className?: string;
  label?: string;
}

export function EChart({ option, onClick, className, label }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const chart = useRef<ECharts | null>(null);
  const optionRef = useRef(option);
  const clickRef = useRef(onClick);

  const apply = () => {
    if (!chart.current) return;
    const family = getComputedStyle(document.documentElement).getPropertyValue("--font-body").trim();
    chart.current.setOption({ ...optionRef.current, textStyle: { fontFamily: family || "sans-serif" } }, true);
  };

  useEffect(() => {
    let disposed = false;
    let observer: ResizeObserver | undefined;
    (async () => {
      const echarts = await import("echarts");
      if (disposed || !host.current) return;
      const c = echarts.init(host.current, undefined, { renderer: "canvas" });
      chart.current = c;
      c.on("click", (p) => clickRef.current?.(p as unknown as Record<string, unknown>));
      observer = new ResizeObserver(() => c.resize());
      observer.observe(host.current);
      apply();
    })();
    return () => {
      disposed = true;
      observer?.disconnect();
      chart.current?.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    clickRef.current = onClick;
  });

  useEffect(() => {
    optionRef.current = option;
    apply();
  }, [option]);

  return <div ref={host} className={className ?? "h-full w-full"} role="img" aria-label={label} />;
}
