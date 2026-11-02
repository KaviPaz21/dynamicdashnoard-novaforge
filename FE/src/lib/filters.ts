import type { ActiveFilter, Bucket, Widget } from "./types";

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

export function bucketRange(bucket: Bucket, label: string): [string, string] | null {
  try {
    if (bucket === "year") return [`${label}-01-01`, `${label}-12-31`];
    if (bucket === "month") {
      const [y, m] = label.split("-").map(Number);
      return [`${label}-01`, iso(new Date(Date.UTC(y, m, 0)))];
    }
    if (bucket === "quarter") {
      const [y, q] = label.split("-Q").map(Number);
      return [`${y}-${pad((q - 1) * 3 + 1)}-01`, iso(new Date(Date.UTC(y, q * 3, 0)))];
    }
    if (bucket === "week") {
      const d = new Date(`${label}T00:00:00Z`);
      return [label, iso(new Date(d.getTime() + 6 * 86400000))];
    }
    return [label, label];
  } catch {
    return null;
  }
}

export function dimensionSource(widget: Widget, outName: string | null | undefined) {
  if (!outName || !widget.query) return null;
  const d = widget.query.dimensions.find((x) => (x.alias || x.column) === outName);
  return d ? { column: d.column, bucket: d.bucket ?? null } : null;
}

export function valuesOf(filters: ActiveFilter[], origin: string, column: string): Set<string> {
  const out = new Set<string>();
  for (const f of filters) {
    if (f.origin_widget_id !== origin || f.column !== column) continue;
    if (f.label) out.add(f.label);
    else if (Array.isArray(f.value) && f.op === "in") f.value.forEach((v) => out.add(String(v)));
    else out.add(String(f.value));
  }
  return out;
}

export function describeFilter(f: ActiveFilter): string {
  const v = Array.isArray(f.value) ? f.value : [f.value];
  const col = f.column.replace(/_/g, " ");
  if (f.label) return `${col}: ${f.label}`;
  if (f.op === "between") return `${col}: ${v[0]} → ${v[1]}`;
  if (f.op === "in") return `${col}: ${v.map(String).join(", ")}`;
  const sym = { eq: "=", neq: "≠", gt: ">", gte: "≥", lt: "<", lte: "≤", contains: "∋", not_in: "∉", in: "∈", between: "↔" }[f.op];
  return `${col} ${sym} ${String(f.value)}`;
}
