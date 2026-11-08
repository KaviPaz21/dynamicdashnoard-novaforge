export type ThemeName = "light" | "dark";

export interface Colors {
  ink: { primary: string; secondary: string; muted: string; grid: string; axis: string; surface: string; tooltip: string };
  series: readonly string[];
  kpi: readonly string[]; // KPI cards are the only coloured visuals
  other: string;
  sequential: readonly string[];
  ordinal: readonly string[];
  accent: string;
  accentFill: string;
  noData: string;
  land: string;
  border: string;
  shadow: string;
  hoverWash: string;
  heatLabel: (t: number) => string;
  onFill: (i: number) => string;
}

const DARK_INK = "#0b0b0d";

export const COLORS: Record<ThemeName, Colors> = {
  dark: {
    ink: {
      primary: "#f2f2f3", secondary: "#b0b0b5", muted: "#7f7f85",
      grid: "#232326", axis: "#38383c", surface: "#141415", tooltip: "#1b1b1d",
    },
    series: ["#f2f2f3", "#7d7d83", "#bdbdc2", "#4f4f55", "#dcdce0", "#9a9aa0"],
    kpi: ["#3987e5", "#12a595", "#9085e9", "#d55181", "#e66767"],
    other: "#6a6a70",
    sequential: ["#1a1a1c", "#2d2d31", "#4a4a50", "#76767c", "#acacb1", "#ececee"],
    ordinal: ["#ececee", "#c4c4c9", "#9c9ca2", "#7a7a80", "#5c5c62", "#46464b"],
    accent: "#f2f2f3",
    accentFill: "#f2f2f3",
    noData: "#1b1b1d",
    land: "#1f1f21",
    border: "#38383c",
    shadow: "rgba(0,0,0,.55)",
    hoverWash: "rgba(255,255,255,0.05)",
    heatLabel: (t) => (t > 0.62 ? DARK_INK : "#ffffff"),
    onFill: (i) => (i === 3 ? "#ffffff" : DARK_INK),
  },
  light: {
    ink: {
      primary: "#0b0b0d", secondary: "#55555a", muted: "#85858b",
      grid: "#e6e6e8", axis: "#d2d2d6", surface: "#ffffff", tooltip: "#ffffff",
    },
    series: ["#0b0b0d", "#8c8c92", "#4a4a50", "#b8b8be", "#2a2a2e", "#d4d4d8"],
    kpi: ["#2a78d6", "#009688", "#6250d6", "#e87ba4", "#e34948"],
    other: "#a0a0a6",
    sequential: ["#f1f1f2", "#d9d9dc", "#b4b4b9", "#8a8a90", "#55555b", "#1c1c20"],
    ordinal: ["#b4b4b9", "#8a8a90", "#6b6b71", "#55555b", "#3a3a3f", "#1c1c20"],
    accent: "#0b0b0d",
    accentFill: "#0b0b0d",
    noData: "#f0f0f1",
    land: "#e6e6e8",
    border: "#cfcfd3",
    shadow: "rgba(0,0,0,.18)",
    hoverWash: "rgba(0,0,0,0.05)",
    heatLabel: (t) => (t > 0.5 ? "#ffffff" : "#0b0b0d"),
    onFill: (i) => (i % 2 === 0 ? "#ffffff" : DARK_INK),
  },
};

export const seriesColor = (c: Colors, i: number) => (i < c.series.length ? c.series[i] : c.other);

export const withAlpha = (hex: string, a: number) =>
  `rgba(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(",")},${a})`;
