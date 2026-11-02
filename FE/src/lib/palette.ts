export type ThemeName = "light" | "dark";

export interface Colors {
  ink: { primary: string; secondary: string; muted: string; grid: string; axis: string; surface: string; tooltip: string };
  series: readonly string[];
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

const DARK_INK = "#0e0c14";

export const COLORS: Record<ThemeName, Colors> = {
  dark: {
    ink: {
      primary: "#eceef2", secondary: "#aeb4c0", muted: "#7a8190",
      grid: "#21252d", axis: "#323844", surface: "#101216", tooltip: "#171a20",
    },
    series: ["#3987e5", "#12a595", "#9085e9", "#d55181", "#008300", "#e66767"],
    other: "#7a8190",
    sequential: ["#18232c", "#233a49", "#3a6f8c", "#6fa8c7", "#a7cde0", "#e3f0f7"],
    ordinal: ["#a7cde0", "#6fa8c7", "#4d8cae", "#3f7c9c", "#2f6784", "#245571"],
    accent: "#78b0d0",
    accentFill: "#78b0d0",
    noData: "#171a20",
    land: "#1b1f26",
    border: "#303642",
    shadow: "rgba(0,0,0,.55)",
    hoverWash: "rgba(255,255,255,0.05)",
    heatLabel: (t) => (t > 0.62 ? DARK_INK : "#ffffff"),
    onFill: () => "#ffffff",
  },
  light: {
    ink: {
      primary: "#0e0c14", secondary: "#5d656d", muted: "#81858e",
      grid: "#e6ecf1", axis: "#d0dae2", surface: "#ffffff", tooltip: "#ffffff",
    },
    series: ["#2a78d6", "#009688", "#6250d6", "#e87ba4", "#008300", "#e34948"],
    other: "#8e9aa5",
    sequential: ["#e8f1f6", "#c6e1f3", "#9cc3d6", "#6fa3bf", "#477b99", "#2c5a75"],
    ordinal: ["#86b2c9", "#6fa3bf", "#477b99", "#3a6a86", "#2c5a75", "#1f4a63"],
    accent: "#477b99",
    accentFill: "#477b99",
    noData: "#eef3f7",
    land: "#e4ecf2",
    border: "#cbd7e0",
    shadow: "rgba(71,123,153,.22)",
    hoverWash: "rgba(71,123,153,0.06)",
    heatLabel: (t) => (t > 0.5 ? "#ffffff" : "#0e0c14"),
    onFill: (i) => (i === 3 ? DARK_INK : "#ffffff"),
  },
};

export const seriesColor = (c: Colors, i: number) => (i < c.series.length ? c.series[i] : c.other);

export const withAlpha = (hex: string, a: number) =>
  `rgba(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(",")},${a})`;
