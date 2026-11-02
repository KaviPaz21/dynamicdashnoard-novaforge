import type { WidgetOptions } from "./types";

export const pretty = (name: string) =>
  name.replace(/[_\-.]+/g, " ").replace(/\s+/g, " ").trim().replace(/^./, (c) => c.toUpperCase());

export const str = (v: unknown): string => (v === null || v === undefined || v === "" ? "(blank)" : String(v));
export const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

export function formatValue(v: unknown, opts: WidgetOptions = {}): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return String(v);
  const dec = opts.decimals;
  const big = Math.abs(n) >= 1e6;
  const digits = dec !== undefined && dec > 2 ? dec : 2;
  let out: string;
  switch (opts.format) {
    case "percent":
      out = `${new Intl.NumberFormat("en", { maximumFractionDigits: dec ?? 1 }).format(n)}%`;
      break;
    case "currency":
      out = new Intl.NumberFormat("en", {
        style: "currency", currency: "USD", notation: big ? "compact" : "standard",
        maximumFractionDigits: big ? digits : (dec ?? (Number.isInteger(n) ? 0 : 2)),
      }).format(n);
      break;
    default:
      out = new Intl.NumberFormat("en", {
        notation: big ? "compact" : "standard",
        maximumFractionDigits: big ? digits : (dec ?? (Number.isInteger(n) ? 0 : 2)),
      }).format(n);
  }
  return opts.unit && opts.format !== "percent" && opts.format !== "currency" ? `${out} ${opts.unit}` : out;
}

export const compact = (n: number) =>
  new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n);
