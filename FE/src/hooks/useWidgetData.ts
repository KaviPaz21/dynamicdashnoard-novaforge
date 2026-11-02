"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import type { QueryResult, QuerySpec, Widget } from "@/lib/types";
import { useApp } from "@/store/useApp";

interface State {
  data: QueryResult | null;
  loading: boolean;
  error: string | null;
}

interface Fetched {
  key: string;
  data: QueryResult | null;
  error: string | null;
}

export interface Override {
  spec: QuerySpec | null;
  initial?: QueryResult | null;
}

export function useWidgetData(widget: Widget, override?: Override): State {
  const filters = useApp((s) => s.filters);
  const spec = override ? override.spec : (widget.query ?? null);
  const computed = override ? (override.initial ?? null) : (widget.data ?? null);
  const foreign = useMemo(() => filters.filter((f) => f.origin_widget_id !== widget.id), [filters, widget.id]);
  const key = JSON.stringify([spec, foreign]);
  const initial = foreign.length === 0 ? computed : null;
  const needFetch = !!spec && !initial;
  const [fetched, setFetched] = useState<Fetched | null>(null);

  useEffect(() => {
    if (!needFetch || !spec) return;
    const ctrl = new AbortController();
    api
      .query(spec, foreign, widget.id, ctrl.signal)
      .then((data) => setFetched({ key, data, error: null }))
      .catch((e) => {
        if (!ctrl.signal.aborted) setFetched({ key, data: null, error: e instanceof Error ? e.message : String(e) });
      });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, needFetch]);

  if (!spec) return { data: null, loading: false, error: null };
  if (initial) return { data: initial, loading: false, error: null };
  const current = fetched?.key === key;
  return {
    data: fetched?.data ?? null,
    loading: !current,
    error: current ? fetched.error : null,
  };
}
