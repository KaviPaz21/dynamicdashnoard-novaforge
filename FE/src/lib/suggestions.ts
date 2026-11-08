import type { ColumnSchema, SourceDoc } from "./types";

const human = (name: string) => name.replace(/[_\-.]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/\s+/g, " ").trim().toLowerCase().replace(/\s+(mm s|mm|pct|percent|ms|kg|k|s)$/, "");
const short = (s: string, n = 42) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
// "Azure Usage by Month (Pivot Export).xlsx" -> "Azure Usage by Month"
const title = (s: SourceDoc) =>
  short((s.name || s.filename).replace(/\.[a-z0-9]+$/i, "").replace(/\s*[([].*?[)\]]/g, "").replace(/\s+/g, " ").trim() || s.filename);

// Spreadsheet exports often have auto-generated headers ("Unnamed: 2", "Column3"); a question can't be built on those
const meaningful = (c: ColumnSchema) => !/^(unnamed|column|col|field|f)[\s_:]*\d*$|^unnamed|^\d+$/i.test(c.name.trim());
const measures = (cols: ColumnSchema[]) => cols.filter((c) => c.role === "measure" && meaningful(c));
const dimensions = (cols: ColumnSchema[]) =>
  cols.filter((c) => c.role === "dimension" && meaningful(c) && c.distinct_count >= 2 && c.distinct_count <= 40)
    .sort((a, b) => a.distinct_count - b.distinct_count);

function fromTable(s: SourceDoc, only: boolean): string[] {
  const ms = measures(s.columns);
  const ds = dimensions(s.columns);
  const date = s.columns.find((c) => meaningful(c) && (c.role === "date" || c.dtype === "date" || c.dtype === "datetime"));
  const geo = s.columns.find((c) => meaningful(c) && ["geo_country", "geo_state", "geo_city"].includes(c.role));
  const out = [`Build an overview dashboard of ${only ? title(s) : `the ${title(s)} data`}`];
  if (ms[0] && ds[0]) out.push(`Which ${human(ds[0].name)} has the highest ${human(ms[0].name)}?`);
  if (ms[0] && date) out.push(`How has ${human(ms[0].name)} changed over time?`);
  if (ms[0] && geo) out.push(`Show ${human(ms[0].name)} by ${human(geo.name)} on a map`);
  if (ms[0] && ms[1]) out.push(`Is ${human(ms[0].name)} related to ${human(ms[1].name)}?`);
  if (ms[1] && ds[1]) out.push(`Rank ${human(ds[1].name)} by ${human(ms[1].name)} and explain why`);
  else if (ms[0] && ds[0]) out.push(`Rank ${human(ds[0].name)} by ${human(ms[0].name)} and explain why`);
  if (out.length < 3) {
    // no usable column names to build on: stay general rather than quote headers like "Unnamed: 2"
    out.push(`What are the most important numbers in ${title(s)}?`, `Which values stand out in ${title(s)}, and why?`);
  }
  return out;
}

function fromDocument(s: SourceDoc): string[] {
  const out = [`Summarise the key findings in ${title(s)}`];
  const topic = s.topics?.[0];
  if (topic) out.push(`What does ${title(s)} say about ${topic.toLowerCase()}?`);
  return out;
}

/** Starter questions that fit what the person can actually ask about: their own tables and documents plus the global ones.
 *  Built from the real column roles and document topics, so they change as knowledge is added or removed. */
export function starterQuestions(sources: SourceDoc[], max = 4): string[] {
  const ready = sources.filter((s) => s.status === "ready" && !s.conversation_id);
  const tables = ready.filter((s) => s.kind === "tabular").sort((a, b) => b.row_count - a.row_count).slice(0, 2);
  const docs = ready.filter((s) => s.kind === "text").slice(0, 2);
  if (!ready.length) return [];

  const lists: string[][] = [
    ...tables.map((t) => fromTable(t, tables.length === 1)),
    ...docs.map(fromDocument),
  ];
  const first = tables[0] ? measures(tables[0].columns)[0] : undefined;
  if (tables[0] && docs[0] && first) lists.push([`Explain the ${human(first.name)} results using the documents`]);

  // round-robin so every table and document is represented before one of them contributes a second question
  const picked: string[] = [];
  for (let round = 0; picked.length < max; round++) {
    let any = false;
    for (const l of lists) {
      if (l[round] && !picked.includes(l[round])) {
        picked.push(l[round]);
        any = true;
        if (picked.length === max) break;
      }
    }
    if (!any) break;
  }
  return picked;
}
