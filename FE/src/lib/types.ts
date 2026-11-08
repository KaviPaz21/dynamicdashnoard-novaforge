export type ColumnType = "string" | "integer" | "float" | "boolean" | "date" | "datetime";
export type ColumnRole =
  | "dimension" | "measure" | "date" | "geo_lat" | "geo_lon" | "geo_country" | "geo_state" | "geo_city" | "id" | "text";

export interface ColumnSchema {
  name: string;
  dtype: ColumnType;
  role: ColumnRole;
  description: string;
  null_count: number;
  distinct_count: number;
  top_values: unknown[];
  min: unknown;
  max: unknown;
  mean: number | null;
}

export interface Relationship {
  id: string;
  from_source: string;
  from_column: string;
  to_source: string;
  to_column: string;
  kind: "auto" | "manual";
}

export interface SourceDoc {
  id: string;
  kind: "tabular" | "text";
  filename: string;
  name: string;
  status: "processing" | "ready" | "failed" | "deleting";
  stage: string;
  error: string | null;
  warnings: string[];
  created_at: string;
  description: string;
  row_count: number;
  columns: ColumnSchema[];
  chunk_count: number;
  page_count: number;
  topics: string[];
  visibility: "private" | "global";
  owner_id: string | null;
  owner_name: string;
  conversation_id: string | null;
  size_bytes: number;
}

export type Role = "admin" | "client";
export type KbScope = "all" | "local" | "global";

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  must_change_password: boolean;
  created_at: string;
  last_active: string | null;
}
export interface AuthSession {
  token: string;
  expires_at: string;
  user: User;
}
export interface UsageStats {
  prompts: number;
  sessions: number;
  tokens_in: number;
  tokens_out: number;
  tokens_total: number;
  flagged: number;
  uploads: number;
}
export interface UserDetail extends User {
  last_login: string | null;
  usage: UsageStats;
  conversations: number;
  sheets: number;
  private_sources: number;
  flags_total: number;
  flags_unreviewed: number;
}
export interface Flag {
  id: string;
  user_id: string;
  user_name: string;
  user_email: string;
  conversation_id: string;
  created_at: string;
  prompt: string;
  response: string;
  categories: string[];
  severity: "low" | "medium" | "high";
  reason: string;
  blocked: boolean;
  detection: string;
  reviewed: boolean;
  reviewed_by: string | null;
  reviewed_at: string | null;
}
export interface FlaggedUser {
  user_id: string;
  user_name: string;
  user_email: string;
  total: number;
  unreviewed: number;
  last_at: string;
  severity: "low" | "medium" | "high";
}

export interface TraceEvent {
  kind: "guard" | "select" | "thought" | "query" | "retry" | "retrieval" | "info";
  node: string;
  title: string;
  detail?: string | null;
  data?: Record<string, unknown>;
  ts: number;
}
export interface ChatSessionInfo {
  id: string;
  title: string;
  updated_at: string | null;
  messages: number;
}

export type FilterOp = "eq" | "neq" | "in" | "not_in" | "gt" | "gte" | "lt" | "lte" | "between" | "contains";
export type Agg = "sum" | "avg" | "min" | "max" | "count" | "count_distinct" | "median";
export type Bucket = "day" | "week" | "month" | "quarter" | "year";

export interface Filter {
  column: string;
  op: FilterOp;
  value: unknown;
}
export interface ActiveFilter extends Filter {
  source_id: string;
  origin_widget_id?: string | null;
  label?: string;
}
export interface Dimension {
  column: string;
  bucket?: Bucket | null;
  alias?: string | null;
}
export interface Measure {
  column: string | null;
  agg: Agg;
  alias: string;
}
export interface QuerySpec {
  source_id: string;
  dimensions: Dimension[];
  measures: Measure[];
  select: string[];
  filters: Filter[];
  sort: { by: string; dir: "asc" | "desc" }[];
  limit?: number | null;
}
export interface ResultColumn {
  name: string;
  dtype: ColumnType;
}
export type Row = Record<string, unknown>;
export interface QueryResult {
  columns: ResultColumn[];
  rows: Row[];
  total_rows: number;
  truncated: boolean;
}

export type WidgetType =
  | "card" | "bar" | "column" | "stacked_bar" | "stacked_column" | "line" | "area"
  | "pie" | "donut" | "scatter" | "bubble" | "heatmap" | "treemap" | "funnel"
  | "gauge" | "radar" | "table" | "matrix" | "map" | "slicer" | "insight";
export type SlicerMode = "dropdown" | "list" | "range" | "date_range";

export interface Encoding {
  x?: string | null;
  y: string[];
  series?: string | null;
  category?: string | null;
  value?: string | null;
  size?: string | null;
  lat?: string | null;
  lon?: string | null;
  location?: string | null;
  region?: string | null;
  geo?: "lat_lon" | "country" | "us_state" | "city" | null;
  label?: string | null;
  rows?: string | null;
  columns?: string | null;
}
export interface WidgetOptions {
  format?: "number" | "compact" | "percent" | "currency" | "duration";
  unit?: string;
  decimals?: number;
  max?: number;
}
export interface Layout {
  w: number;
  h: number;
  x: number;
  y: number;
}
export interface Widget {
  id: string;
  type: WidgetType;
  title: string;
  subtitle?: string | null;
  source_id?: string | null;
  query?: QuerySpec | null;
  trend?: QuerySpec | null;
  trend_data?: QueryResult | null;
  encoding: Encoding;
  options: WidgetOptions;
  layout: Layout;
  slicer_column?: string | null;
  slicer_mode?: SlicerMode | null;
  content?: string | null;
  cross_filter: boolean;
  replaces?: string | null;
  data?: QueryResult | null;
  error?: string | null;
}
export interface Dashboard {
  title: string;
  widgets: Widget[];
}
export interface SheetInfo {
  id: string;
  name: string;
  widget_count: number;
  updated_at: string;
}
export interface Sheet {
  id: string;
  name: string;
  widgets: Widget[];
  filters: ActiveFilter[];
  created_at: string;
  updated_at: string;
}

export interface Citation {
  source_id: string;
  filename: string;
  page?: number | null;
  chunk_index: number;
  snippet: string;
  score?: number | null;
}
export interface ChatResponse {
  conversation_id: string;
  message: string;
  intent: string;
  reasoning: string;
  dashboard_action: "replace" | "append" | "remove" | "none";
  dashboard_title?: string | null;
  widgets: Widget[];
  remove_widget_ids: string[];
  citations: Citation[];
  suggestions: string[];
  blocked?: boolean;
  trace?: TraceEvent[];
  title?: string | null;
}
export interface ChatRequest {
  message: string;
  conversation_id?: string | null;
  dashboard?: Dashboard | null;
  filters: ActiveFilter[];
  kb_scope: KbScope;
  attachment_ids: string[];
}
export interface Health {
  store: "cosmos" | "memory";
  llm_configured: boolean;
  llm_model: string;
  embeddings_configured: boolean;
}
export type StreamEvent =
  | { event: "start"; data: { conversation_id: string } }
  | { event: "step"; data: { node: string } }
  | { event: "trace"; data: TraceEvent }
  | { event: "title"; data: { id: string; title: string } }
  | { event: "final"; data: ChatResponse }
  | { event: "error"; data: { message: string; status?: number } };
