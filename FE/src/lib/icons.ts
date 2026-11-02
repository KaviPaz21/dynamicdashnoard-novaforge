import type { Widget } from "./types";

export type IconKey =
  | "profit" | "money" | "orders" | "units" | "people" | "percent" | "fire" | "temp" | "wind" | "gauge"
  | "lab" | "time" | "place" | "truck" | "target" | "count" | "activity";

const RULES: [RegExp, IconKey][] = [
  [/profit|margin|earn|gain/i, "profit"],
  [/sales|revenue|income|price|cost|spend|amount|\$|usd|billing/i, "money"],
  [/order|invoice|transaction|purchase/i, "orders"],
  [/unit|quantity|qty|item|product|stock|inventory|volume/i, "units"],
  [/customer|user|people|employee|member|client|subscriber|crew|astronaut/i, "people"],
  [/discount|rate|percent|ratio|share|%/i, "percent"],
  [/flame|fire|burn|ignit|combust|extinguish|soot/i, "fire"],
  [/temp|heat|thermal|kelvin/i, "temp"],
  [/speed|velocity|spread|flow/i, "wind"],
  [/oxygen|pressure|gas|gravity|atmosphere/i, "gauge"],
  [/experiment|test|trial|sample|run|study|material/i, "lab"],
  [/time|duration|delay|latency|hour|minute|second|day/i, "time"],
  [/state|city|country|region|location|site|facility|platform|map/i, "place"],
  [/ship|deliver|freight|logistic/i, "truck"],
  [/target|goal|quota|kpi/i, "target"],
  [/total|count|number|sum|distinct|unique/i, "count"],
];

export function iconKey(w: Widget): IconKey {
  const text = [w.title, w.subtitle, ...(w.query?.measures.map((m) => `${m.alias} ${m.column ?? ""}`) ?? [])].join(" ");
  for (const [re, key] of RULES) if (re.test(text)) return key;
  return "activity";
}
