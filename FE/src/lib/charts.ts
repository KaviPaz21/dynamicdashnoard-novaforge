import type { EChartsOption } from "echarts";
import type { QueryResult, Widget } from "./types";
import { seriesColor, type Colors } from "./palette";
import { compact, formatValue, num, pretty, str } from "./format";

export interface ChartCtx {
  widget: Widget;
  data: QueryResult;
  selected: Set<string>;
  colors: Colors;
}

const DIM = 0.3;
const MAX_SERIES = 6;

const tooltipBase = (c: Colors) => ({
  backgroundColor: c.ink.tooltip,
  borderColor: c.ink.axis,
  borderWidth: 1,
  padding: [8, 10],
  textStyle: { color: c.ink.primary, fontSize: 12 },
  extraCssText: `border-radius:8px;box-shadow:0 8px 24px ${c.shadow};`,
});

const axisText = (c: Colors) => ({ color: c.ink.secondary, fontSize: 11 });

function uniq<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

function foldSeries(names: string[]): { shown: string[]; hasOther: boolean } {
  if (names.length <= MAX_SERIES) return { shown: names, hasOther: false };
  return { shown: names.slice(0, MAX_SERIES - 1), hasOther: true };
}

export function buildOption(ctx: ChartCtx): EChartsOption | null {
  const { widget: w } = ctx;
  switch (w.type) {
    case "bar":
    case "column":
    case "stacked_bar":
    case "stacked_column":
    case "line":
    case "area":
      return cartesian(ctx);
    case "pie":
    case "donut":
      return pie(ctx);
    case "treemap":
      return treemap(ctx);
    case "funnel":
      return funnel(ctx);
    case "scatter":
    case "bubble":
      return scatter(ctx);
    case "heatmap":
      return heatmap(ctx);
    case "radar":
      return radar(ctx);
    case "gauge":
      return gauge(ctx);
    default:
      return null;
  }
}

function cartesian({ widget: w, data, selected, colors: c }: ChartCtx): EChartsOption {
  const enc = w.encoding;
  const xKey = enc.x!;
  const horizontal = w.type === "bar" || w.type === "stacked_bar";
  const stacked = w.type === "stacked_bar" || w.type === "stacked_column";
  const isLine = w.type === "line" || w.type === "area";
  const fmt = (v: unknown) => formatValue(v, w.options);

  const cats = uniq(data.rows.map((r) => str(r[xKey])));
  const catIndex = new Map(cats.map((c, i) => [c, i]));

  let defs: { name: string; values: (number | null)[] }[] = [];
  if (enc.series) {
    const yKey = enc.y[0];
    const allNames = uniq(data.rows.map((r) => str(r[enc.series!])));
    const { shown, hasOther } = foldSeries(allNames);
    const byName = new Map<string, (number | null)[]>();
    for (const n of [...shown, ...(hasOther ? ["Other"] : [])]) byName.set(n, cats.map(() => null));
    for (const r of data.rows) {
      const raw = str(r[enc.series]);
      const name = byName.has(raw) ? raw : "Other";
      const arr = byName.get(name)!;
      const i = catIndex.get(str(r[xKey]))!;
      const v = num(r[yKey]);
      arr[i] = v === null ? arr[i] : (arr[i] ?? 0) + v;
    }
    defs = [...byName.entries()].map(([name, values]) => ({ name, values }));
  } else {
    defs = enc.y.slice(0, MAX_SERIES).map((y) => {
      const values: (number | null)[] = cats.map(() => null);
      for (const r of data.rows) values[catIndex.get(str(r[xKey]))!] = num(r[y]);
      return { name: pretty(y), values };
    });
  }

  const multi = defs.length > 1;
  const single = defs.length === 1;
  const showLabels = single && !isLine && cats.length <= 12;
  const radius = horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0];

  const series = defs.map((d, i) => {
    const color = d.name === "Other" ? c.other : seriesColor(c, i);
    const items = d.values.map((v, j) => {
      const dim = !isLine && selected.size > 0 && !selected.has(cats[j]);
      return dim ? { value: v, itemStyle: { opacity: DIM } } : { value: v };
    });
    const common = { name: d.name, data: items, color };
    if (isLine) {
      return {
        ...common,
        type: "line" as const,
        smooth: false,
        showSymbol: cats.length <= 40,
        symbol: "circle",
        symbolSize: 7,
        lineStyle: { width: 2 },
        itemStyle: { color, borderColor: c.ink.surface, borderWidth: 2 },
        areaStyle: w.type === "area" ? { opacity: stacked || multi ? 0.18 : 0.16 } : undefined,
        stack: w.type === "area" && multi ? "total" : undefined,
        emphasis: { focus: "series" as const },
      };
    }
    return {
      ...common,
      type: "bar" as const,
      stack: stacked ? "total" : undefined,
      barMaxWidth: 30,
      barCategoryGap: "35%",
      itemStyle: {
        color,
        borderRadius: stacked ? (i === defs.length - 1 ? radius : 0) : radius,
        borderColor: c.ink.surface,
        borderWidth: stacked ? 1.5 : 0,
      },
      label: showLabels
        ? {
            show: true,
            position: horizontal ? ("right" as const) : ("top" as const),
            color: c.ink.secondary,
            fontSize: 11,
            formatter: (p: { value: unknown }) => fmt(p.value),
          }
        : undefined,
      emphasis: { focus: "series" as const },
    };
  });

  const valueAxis = {
    type: "value" as const,
    axisLabel: { ...axisText(c), formatter: (v: number) => compact(v) },
    splitLine: { lineStyle: { color: c.ink.grid } },
    axisLine: { show: false },
    axisTick: { show: false },
  };
  const categoryAxis = {
    type: "category" as const,
    data: cats,
    inverse: horizontal,
    axisLabel: {
      ...axisText(c),
      hideOverlap: true,
      width: horizontal ? 110 : undefined,
      overflow: "truncate" as const,
      ...(!horizontal && !isLine && cats.length <= 14
        ? { interval: 0, rotate: cats.some((c) => c.length > 6) ? 35 : 0 }
        : {}),
    },
    axisLine: { lineStyle: { color: c.ink.axis } },
    axisTick: { show: false },
    boundaryGap: !isLine,
  };

  return {
    backgroundColor: "transparent",
    animationDuration: 400,
    legend: multi
      ? { top: 0, icon: "roundRect", itemWidth: 10, itemHeight: 10, textStyle: { color: c.ink.secondary, fontSize: 11 } }
      : undefined,
    grid: { left: 8, right: showLabels && horizontal ? 48 : 16, top: multi ? 34 : 14, bottom: 6, containLabel: true },
    tooltip: {
      ...tooltipBase(c),
      trigger: "axis",
      axisPointer: { type: isLine ? "line" : "shadow", shadowStyle: { color: c.hoverWash } },
      valueFormatter: (v: unknown) => fmt(v),
    },
    xAxis: horizontal ? valueAxis : categoryAxis,
    yAxis: horizontal ? categoryAxis : valueAxis,
    series,
  } as EChartsOption;
}

function categorical({ widget: w, data, selected, colors: c }: ChartCtx, foldTail = false) {
  const enc = w.encoding;
  const raw = data.rows
    .map((r) => ({ name: str(r[enc.category!]), value: num(r[enc.value!]) ?? 0 }))
    .filter((d) => d.value > 0)
    .sort((a, b) => b.value - a.value);
  let items = raw;
  if (foldTail && raw.length > MAX_SERIES) {
    const rest = raw.slice(MAX_SERIES - 1).reduce((s, d) => s + d.value, 0);
    items = [...raw.slice(0, MAX_SERIES - 1), { name: "Other", value: rest }];
  }
  return items.map((d, i) => ({
    ...d,
    itemStyle: {
      color: d.name === "Other" ? c.other : seriesColor(c, i),
      borderColor: c.ink.surface,
      borderWidth: 2,
      opacity: selected.size > 0 && !selected.has(d.name) ? DIM : 1,
    },
  }));
}

function pie(ctx: ChartCtx): EChartsOption {
  const { widget: w, colors: c } = ctx;
  const items = categorical(ctx, true);
  const fmt = (v: unknown) => formatValue(v, w.options);
  const total = items.reduce((s, d) => s + d.value, 0);
  const donut = w.type === "donut";
  return {
    backgroundColor: "transparent",
    tooltip: { ...tooltipBase(c), trigger: "item", valueFormatter: (v: unknown) => fmt(v) },
    legend: { bottom: 0, icon: "roundRect", itemWidth: 10, itemHeight: 10, textStyle: { color: c.ink.secondary, fontSize: 11 } },
    title: donut
      ? {
          text: fmt(total), subtext: "total", left: "center", top: "37%",
          textStyle: { color: c.ink.primary, fontSize: 20, fontWeight: 600 },
          subtextStyle: { color: c.ink.muted, fontSize: 11 },
        }
      : undefined,
    series: [
      {
        type: "pie",
        radius: donut ? ["54%", "76%"] : ["0%", "74%"],
        center: ["50%", "46%"],
        data: items,
        minAngle: 3,
        label: { show: items.length <= 6 && !donut, color: c.ink.secondary, fontSize: 11, formatter: "{d}%" },
        labelLine: { lineStyle: { color: c.ink.axis } },
        emphasis: { scaleSize: 4 },
      },
    ],
  };
}

function treemap(ctx: ChartCtx): EChartsOption {
  const c = ctx.colors;
  const items = categorical(ctx).map((d, i) => ({ ...d, label: { color: d.name === "Other" ? "#ffffff" : c.onFill(i) } }));
  const fmt = (v: unknown) => formatValue(v, ctx.widget.options);
  return {
    backgroundColor: "transparent",
    tooltip: { ...tooltipBase(c), valueFormatter: (v: unknown) => fmt(v) },
    series: [
      {
        type: "treemap",
        data: items,
        roam: false,
        nodeClick: false,
        breadcrumb: { show: false },
        left: 0, right: 0, top: 0, bottom: 0,
        label: { show: true, fontSize: 12, formatter: (p: { name: string; value: unknown }) => `${p.name}\n${fmt(p.value)}` },
        itemStyle: { borderColor: c.ink.surface, borderWidth: 2, gapWidth: 2, borderRadius: 4 },
      },
    ],
  };
}

function funnel(ctx: ChartCtx): EChartsOption {
  const c = ctx.colors;
  const items = categorical(ctx).map((d, i) => ({
    ...d,
    itemStyle: { ...d.itemStyle, color: c.ordinal[Math.min(i, c.ordinal.length - 1)] },
    label: { color: i < 2 ? "#0b0b0b" : "#ffffff" },
  }));
  const fmt = (v: unknown) => formatValue(v, ctx.widget.options);
  return {
    backgroundColor: "transparent",
    tooltip: { ...tooltipBase(c), valueFormatter: (v: unknown) => fmt(v) },
    series: [
      {
        type: "funnel",
        left: "8%", width: "84%", top: 8, bottom: 8,
        sort: "descending",
        gap: 2,
        data: items,
        label: { position: "inside", fontSize: 12, formatter: (p: { name: string; value: unknown }) => `${p.name}  ${fmt(p.value)}` },
      },
    ],
  };
}

function scatter({ widget: w, data, colors: c }: ChartCtx): EChartsOption {
  const enc = w.encoding;
  const xKey = enc.x!;
  const yKey = enc.y[0];
  const sizeKey = w.type === "bubble" ? enc.size : null;
  const sizes = sizeKey ? data.rows.map((r) => num(r[sizeKey]) ?? 0) : [];
  const maxSize = Math.max(1, ...sizes);
  const labelKey = enc.label;

  const groups = new Map<string, typeof data.rows>();
  if (enc.series) {
    const names = foldSeries(uniq(data.rows.map((r) => str(r[enc.series!]))));
    for (const r of data.rows) {
      const n = str(r[enc.series]);
      const key = names.shown.includes(n) ? n : "Other";
      groups.set(key, [...(groups.get(key) ?? []), r]);
    }
  } else groups.set(pretty(yKey), data.rows);

  const multi = groups.size > 1;
  const series = [...groups.entries()].map(([name, rows], i) => ({
    name,
    type: "scatter" as const,
    color: name === "Other" ? c.other : seriesColor(c, i),
    data: rows.map((r) => [num(r[xKey]), num(r[yKey]), sizeKey ? num(r[sizeKey]) : null, labelKey ? str(r[labelKey]) : ""]),
    symbolSize: sizeKey ? (v: unknown[]) => 8 + 30 * Math.sqrt(((v[2] as number) ?? 0) / maxSize) : 9,
    itemStyle: { opacity: 0.85, borderColor: c.ink.surface, borderWidth: 1.5 },
    emphasis: { focus: "series" as const },
  }));

  const axis = (name: string, vertical = false) => ({
    type: "value" as const,
    scale: true,
    name: pretty(name),
    nameLocation: vertical ? ("end" as const) : ("middle" as const),
    nameGap: vertical ? 12 : 28,
    nameTextStyle: { color: c.ink.muted, fontSize: 11, align: vertical ? ("left" as const) : ("center" as const) },
    axisLabel: { ...axisText(c), formatter: (v: number) => compact(v) },
    splitLine: { lineStyle: { color: c.ink.grid } },
    axisLine: { show: false },
    axisTick: { show: false },
  });
  return {
    backgroundColor: "transparent",
    legend: multi ? { top: 0, icon: "circle", itemWidth: 9, itemHeight: 9, textStyle: { color: c.ink.secondary, fontSize: 11 } } : undefined,
    grid: { left: 8, right: 16, top: multi ? 52 : 34, bottom: 30, containLabel: true },
    tooltip: {
      ...tooltipBase(c),
      trigger: "item",
      formatter: (p: unknown) => {
        const { value, seriesName } = p as { value: [number, number, number | null, string]; seriesName: string };
        const rows = [
          value[3] ? `<b>${value[3]}</b>` : `<b>${seriesName}</b>`,
          `${pretty(xKey)}: ${formatValue(value[0])}`,
          `${pretty(yKey)}: ${formatValue(value[1])}`,
        ];
        if (sizeKey) rows.push(`${pretty(sizeKey)}: ${formatValue(value[2])}`);
        return rows.join("<br/>");
      },
    },
    xAxis: axis(xKey),
    yAxis: axis(yKey, true),
    series,
  } as EChartsOption;
}

function heatmap({ widget: w, data, colors: c }: ChartCtx): EChartsOption {
  const enc = w.encoding;
  const xs = uniq(data.rows.map((r) => str(r[enc.x!])));
  const ys = uniq(data.rows.map((r) => str(r[enc.series!])));
  const vals = data.rows.map((r) => num(r[enc.value!]) ?? 0);
  const fmt = (v: unknown) => formatValue(v, w.options);
  const lo = Math.min(...vals);
  const span = Math.max(...vals) - lo || 1;
  const cells = data.rows.map((r) => {
    const v = num(r[enc.value!]);
    return {
      value: [xs.indexOf(str(r[enc.x!])), ys.indexOf(str(r[enc.series!])), v],
      label: { color: c.heatLabel(v === null ? 0 : (v - lo) / span) },
    };
  });
  return {
    backgroundColor: "transparent",
    tooltip: {
      ...tooltipBase(c),
      formatter: (p: unknown) => {
        const v = (p as { value: [number, number, number] }).value;
        return `${xs[v[0]]} · ${ys[v[1]]}<br/><b>${fmt(v[2])}</b>`;
      },
    },
    grid: { left: 8, right: 16, top: 10, bottom: 44, containLabel: true },
    xAxis: { type: "category", data: xs, splitArea: { show: false }, axisLabel: { ...axisText(c), hideOverlap: true }, axisLine: { lineStyle: { color: c.ink.axis } }, axisTick: { show: false } },
    yAxis: { type: "category", data: ys, inverse: true, axisLabel: axisText(c), axisLine: { show: false }, axisTick: { show: false } },
    visualMap: {
      min: Math.min(...vals), max: Math.max(...vals), calculable: false, orient: "horizontal",
      left: "center", bottom: 0, itemWidth: 10, itemHeight: 120,
      textStyle: { color: c.ink.muted, fontSize: 10 }, inRange: { color: c.sequential },
    },
    series: [
      {
        type: "heatmap", data: cells,
        itemStyle: { borderColor: c.ink.surface, borderWidth: 2, borderRadius: 3 },
        label: { show: xs.length * ys.length <= 40, color: c.ink.primary, fontSize: 10, formatter: (p: { value?: unknown }) => fmt((p.value as unknown[])[2]) },
      },
    ],
  };
}

function radar({ widget: w, data, colors: c }: ChartCtx): EChartsOption {
  const enc = w.encoding;
  const metrics = enc.y;
  const entities = data.rows.slice(0, 6);
  const fmt = (v: unknown) => formatValue(v, w.options);
  const maxes = metrics.map((m) => Math.max(1e-9, ...data.rows.map((r) => num(r[m]) ?? 0)) * 1.15);
  return {
    backgroundColor: "transparent",
    legend: { bottom: 0, icon: "roundRect", itemWidth: 10, itemHeight: 10, textStyle: { color: c.ink.secondary, fontSize: 11 } },
    tooltip: { ...tooltipBase(c), valueFormatter: (v: unknown) => fmt(v) },
    radar: {
      indicator: metrics.map((m, i) => ({ name: pretty(m), max: maxes[i] })),
      radius: "62%", center: ["50%", "46%"],
      axisName: { color: c.ink.secondary, fontSize: 11 },
      splitLine: { lineStyle: { color: c.ink.grid } },
      splitArea: { show: false },
      axisLine: { lineStyle: { color: c.ink.grid } },
    },
    series: [
      {
        type: "radar",
        data: entities.map((r, i) => ({
          name: str(r[enc.category!]),
          value: metrics.map((m) => num(r[m]) ?? 0),
          itemStyle: { color: seriesColor(c, i) },
          lineStyle: { width: 2, color: seriesColor(c, i) },
          areaStyle: { opacity: 0.12, color: seriesColor(c, i) },
        })),
      },
    ],
  };
}

function niceMax(v: number): number {
  const target = Math.max(Math.abs(v) * 1.2, 1);
  const p = Math.pow(10, Math.floor(Math.log10(target)));
  const m = target / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
}

function gauge({ widget: w, data, colors: c }: ChartCtx): EChartsOption {
  const v = num(data.rows[0]?.[w.encoding.value!]) ?? 0;
  const max = w.options.max ?? (w.options.format === "percent" ? 100 : niceMax(v));
  return {
    backgroundColor: "transparent",
    series: [
      {
        type: "gauge", min: 0, max, startAngle: 210, endAngle: -30, radius: "92%", center: ["50%", "58%"],
        progress: { show: true, width: 14, itemStyle: { color: c.series[0] }, roundCap: true },
        axisLine: { roundCap: true, lineStyle: { width: 14, color: [[1, c.ink.grid]] } },
        pointer: { show: false }, axisTick: { show: false }, splitLine: { show: false },
        axisLabel: { color: c.ink.muted, fontSize: 10, distance: 18, formatter: (x: number) => compact(x) },
        detail: {
          valueAnimation: true, offsetCenter: [0, "4%"], color: c.ink.primary, fontSize: 28, fontWeight: 600,
          formatter: (x: number) => formatValue(x, w.options),
        },
        title: { show: false },
        data: [{ value: v }],
      },
    ],
  };
}

export function clickableFields(w: Widget): string[] {
  const e = w.encoding;
  switch (w.type) {
    case "bar": case "column": case "stacked_bar": case "stacked_column": case "line": case "area":
      return e.x ? [e.x] : [];
    case "pie": case "donut": case "treemap": case "funnel":
      return e.category ? [e.category] : [];
    case "heatmap":
      return [e.x, e.series].filter(Boolean) as string[];
    default:
      return [];
  }
}

