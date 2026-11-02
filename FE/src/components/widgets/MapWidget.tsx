"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type * as Leaflet from "leaflet";
import "leaflet/dist/leaflet.css";
import type { GeoMatch } from "@/lib/api";
import { featureId, loadShapes, rampColor, resolvePlaces, type ShapeKind, type Shapes } from "@/lib/geo";
import { formatValue, num, pretty, str } from "@/lib/format";
import type { QueryResult, Widget } from "@/lib/types";
import { useColors } from "@/hooks/useColors";
import { useCrossFilter } from "@/hooks/useCrossFilter";
import { useApp } from "@/store/useApp";

interface Handle {
  L: typeof Leaflet;
  map: Leaflet.Map;
  layer: Leaflet.LayerGroup;
}
interface Place {
  name: string;
  hint: string | null;
  value: number | null;
}
interface Point {
  la: number;
  lo: number;
  name: string;
  label: string;
  hint: string | null;
  value: number | null;
}

const inContiguousUS = (p: Point) => p.la >= 24 && p.la <= 50 && p.lo >= -125 && p.lo <= -66;

export default function MapWidget({ widget, data }: { widget: Widget; data: QueryResult }) {
  const host = useRef<HTMLDivElement>(null);
  const handle = useRef<Handle | null>(null);
  const drawRef = useRef<() => void>(() => {});
  const fitted = useRef<unknown>(null);
  const filters = useApp((s) => s.filters);
  const c = useColors();
  const enc = widget.encoding;
  const mode = enc.geo ?? (enc.lat && enc.lon ? "lat_lon" : null);
  const filled = mode === "us_state" || mode === "country";
  const placeCol = enc.location ?? enc.label;
  const { selectedFor, toggle } = useCrossFilter(widget, data);

  const places = useMemo<Place[]>(() => {
    if (!mode || mode === "lat_lon" || !placeCol) return [];
    const out = new Map<string, Place>();
    for (const row of data.rows) {
      const name = str(row[placeCol]);
      if (name === "(blank)") continue;
      const hint = enc.region ? str(row[enc.region]) : null;
      const v = num(row[enc.value ?? ""]);
      const key = filled ? name : `${name}\u0000${hint}`;
      const prev = out.get(key);
      if (prev) prev.value = (prev.value ?? 0) + (v ?? 0);
      else out.set(key, { name, hint, value: v });
    }
    return [...out.values()];
  }, [data.rows, mode, placeCol, enc.region, enc.value, filled]);

  const placeKey = JSON.stringify([mode, places.map((p) => [p.name, p.hint])]);
  const [resolved, setResolved] = useState<{ key: string; matches: (GeoMatch | null)[] } | null>(null);
  useEffect(() => {
    if (!mode || mode === "lat_lon" || !places.length) return;
    let live = true;
    resolvePlaces(mode, places.map((p) => ({ name: p.name, hint: p.hint }))).then(
      (matches) => live && setResolved({ key: placeKey, matches }),
      () => live && setResolved({ key: placeKey, matches: places.map(() => null) }),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placeKey]);
  const matches = resolved?.key === placeKey ? resolved.matches : null;
  const unmatched = matches ? places.filter((_, i) => !matches[i]) : [];

  const points = useMemo<Point[]>(() => {
    if (mode === "lat_lon" && enc.lat && enc.lon) {
      return data.rows.flatMap((r) => {
        const la = num(r[enc.lat!]);
        const lo = num(r[enc.lon!]);
        if (la === null || lo === null) return [];
        const name = enc.label ? str(r[enc.label]) : "";
        return [{ la, lo, name, label: name, hint: null, value: num(r[enc.size ?? enc.value ?? ""]) }];
      });
    }
    if (mode === "city" && matches) {
      return places.flatMap((p, i) => {
        const m = matches[i];
        return m && m.lat !== undefined && m.lon !== undefined
          ? [{ la: m.lat, lo: m.lon, name: p.name, label: m.label, hint: p.hint, value: p.value }]
          : [];
      });
    }
    return [];
  }, [mode, matches, places, data.rows, enc.lat, enc.lon, enc.label, enc.size, enc.value]);

  const baseKind: ShapeKind | null = !mode ? null : filled ? mode : points.length && points.every(inContiguousUS) ? "us_state" : "country";
  const [shapes, setShapes] = useState<{ kind: ShapeKind; data: Shapes } | null>(null);
  useEffect(() => {
    if (!baseKind) return;
    let live = true;
    loadShapes(baseKind).then((d) => live && setShapes({ kind: baseKind, data: d }));
    return () => {
      live = false;
    };
  }, [baseKind]);

  const valueRange = useMemo(() => {
    const vals = places.map((p) => p.value).filter((v): v is number => v !== null);
    return vals.length ? { min: Math.min(...vals), max: Math.max(...vals) } : null;
  }, [places]);

  const draw = () => {
    const h = handle.current;
    if (!h || !mode) return;
    const { L, map, layer } = h;
    layer.clearLayers();
    const fmt = (v: number | null) => (v === null ? "—" : formatValue(v, widget.options));
    const valueName = enc.value ? pretty(enc.value) : "Value";
    const sel = selectedFor(placeCol);
    const base = shapes && shapes.kind === baseKind ? shapes.data : null;

    if (!filled) {
      if (base) L.geoJSON(base, { interactive: false, style: { fillColor: c.land, fillOpacity: 1, color: c.border, weight: 0.6 } }).addTo(layer);
      const max = Math.max(1e-9, ...points.map((p) => p.value ?? 0));
      for (const p of points) {
        const dim = sel.size > 0 && !sel.has(p.name);
        const m = L.circleMarker([p.la, p.lo], {
          radius: p.value === null ? 7 : 5 + 20 * Math.sqrt(Math.max(0, p.value) / max), color: c.ink.surface, weight: 1.5,
          fillColor: c.series[0], fillOpacity: dim ? 0.2 : 0.78,
        }).addTo(layer);
        m.bindTooltip(
          [
            p.label && `<b>${p.label}</b>${p.hint ? `, ${p.hint}` : ""}`,
            p.value !== null ? `${valueName}: ${fmt(p.value)}` : "",
            `${p.la.toFixed(2)}, ${p.lo.toFixed(2)}`,
          ].filter(Boolean).join("<br/>"),
          { direction: "top" },
        );
        if (placeCol && widget.cross_filter) m.on("click", () => toggle(placeCol, p.name));
      }
      if (points.length && fitted.current !== data) {
        fitted.current = data;
        map.fitBounds(L.latLngBounds(points.map((p) => [p.la, p.lo] as [number, number])), { padding: [36, 36], maxZoom: 6 });
      }
      return;
    }

    if (!matches || !placeCol || !base || !valueRange) return;
    const byId = new Map<string, { value: number; names: string[] }>();
    places.forEach((p, i) => {
      const id = matches[i]?.id;
      if (!id) return;
      const cur = byId.get(id) ?? { value: 0, names: [] };
      cur.value += p.value ?? 0;
      cur.names.push(p.name);
      byId.set(id, cur);
    });
    const span = valueRange.max - valueRange.min || 1;
    const geo = L.geoJSON(base, {
      style: (f) => {
        const hit = f ? byId.get(featureId(f)!) : undefined;
        const chosen = !!hit && hit.names.some((n) => sel.has(n));
        const dim = sel.size > 0 && !chosen;
        return {
          fillColor: hit ? rampColor(c.sequential, Math.sqrt(Math.max(0, (hit.value - valueRange.min) / span))) : c.noData,
          fillOpacity: hit ? (dim ? 0.35 : 0.95) : 0.9,
          color: chosen ? c.accent : c.border, weight: chosen ? 2.5 : 0.7,
        };
      },
      onEachFeature: (f, lyr) => {
        const hit = byId.get(featureId(f)!);
        const name = (f.properties as { name?: string })?.name ?? "";
        lyr.bindTooltip(`<b>${name}</b><br/>${hit ? `${valueName}: ${fmt(hit.value)}` : "No data"}`, { sticky: true });
        if (hit && widget.cross_filter) lyr.on("click", () => toggle(placeCol, hit.names[0]));
      },
    }).addTo(layer);

    if (fitted.current !== data) {
      fitted.current = data;
      const shown = L.geoJSON(base, {
        filter: (f) => {
          const id = featureId(f)!;
          if (mode === "us_state" && (id === "02" || id === "15") && byId.size > 2) return false;
          return byId.has(id);
        },
      });
      const bounds = shown.getLayers().length ? shown.getBounds() : geo.getBounds();
      map.fitBounds(bounds, { padding: [12, 12], maxZoom: mode === "us_state" ? 6 : 4 });
    }
  };

  useEffect(() => {
    drawRef.current = draw;
  });

  useEffect(() => {
    let cancelled = false;
    let observer: ResizeObserver | undefined;
    (async () => {
      const L = (await import("leaflet")).default as unknown as typeof Leaflet;
      if (cancelled || !host.current) return;
      const map = L.map(host.current, { zoomSnap: 0.25, minZoom: 1, maxZoom: 9, attributionControl: false }).setView([25, 0], 2);
      handle.current = { L, map, layer: L.layerGroup().addTo(map) };
      observer = new ResizeObserver(() => map.invalidateSize());
      observer.observe(host.current);
      drawRef.current();
    })();
    return () => {
      cancelled = true;
      observer?.disconnect();
      handle.current?.map.remove();
      handle.current = null;
      fitted.current = null;
    };
  }, []);

  useEffect(() => {
    drawRef.current();
  }, [data, filters, matches, shapes, points, c]);

  if (!mode)
    return <div className="flex h-full items-center justify-center text-sm text-mute">This map has no location column.</div>;

  return (
    <div className="relative h-full w-full">
      <div ref={host} className="h-full w-full overflow-hidden rounded-md" role="img" aria-label={widget.title} />
      {filled && valueRange && (
        <div className="pointer-events-none absolute bottom-2 left-2 z-[1000] rounded-md bg-bg/80 px-2.5 py-1.5 text-[11px] text-ink2 backdrop-blur">
          <div className="mb-1 flex justify-between gap-6 font-mono">
            <span>{formatValue(valueRange.min, widget.options)}</span>
            <span>{formatValue(valueRange.max, widget.options)}</span>
          </div>
          <div className="h-1.5 w-36 rounded-full" style={{ background: `linear-gradient(90deg, ${rampColor(c.sequential, 0)}, ${rampColor(c.sequential, 0.5)}, ${rampColor(c.sequential, 1)})` }} />
          {enc.value && <div className="mt-1 text-mute">{pretty(enc.value)} · √ scale</div>}
        </div>
      )}
      {matches && unmatched.length > 0 && (
        <div
          className="absolute right-2 bottom-2 z-[1000] max-w-[60%] truncate rounded-md bg-bg/80 px-2 py-1 text-[11px] text-warn backdrop-blur"
          title={unmatched.map((p) => p.name).join(", ")}
        >
          {unmatched.length} of {places.length} locations not recognised
        </div>
      )}
    </div>
  );
}
