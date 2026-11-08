const valid = (iso?: string | null) => (iso && !Number.isNaN(new Date(iso).getTime()) ? new Date(iso) : null);

export function fmtDateTime(iso?: string | null): string {
  const d = valid(iso);
  return d ? d.toLocaleString([], { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "never";
}

export function timeAgo(iso?: string | null): string {
  const d = valid(iso);
  if (!d) return "never";
  const s = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 30 * 86_400) return `${Math.floor(s / 86_400)} d ago`;
  return fmtDateTime(iso);
}

export const nf = (n: number) => n.toLocaleString();
