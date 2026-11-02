import type { Feature, FeatureCollection, Geometry } from "geojson";
import type { GeometryCollection, Topology } from "topojson-specification";
import { api, type GeoKind, type GeoMatch } from "./api";

export type Shapes = FeatureCollection<Geometry, { name?: string }>;
export type ShapeKind = "us_state" | "country";

const shapeCache = new Map<ShapeKind, Promise<Shapes>>();

function unwrapRings(rings: number[][][]) {
  for (const ring of rings) {
    let prev = ring[0][0];
    for (let i = 1; i < ring.length; i++) {
      let lon = ring[i][0];
      while (lon - prev > 180) lon -= 360;
      while (lon - prev < -180) lon += 360;
      ring[i][0] = lon;
      prev = lon;
    }
  }
}

export function loadShapes(kind: ShapeKind): Promise<Shapes> {
  if (!shapeCache.has(kind)) {
    shapeCache.set(
      kind,
      (async () => {
        const { feature } = await import("topojson-client");
        const topo = (
          kind === "us_state" ? (await import("us-atlas/states-10m.json")).default : (await import("world-atlas/countries-110m.json")).default
        ) as unknown as Topology;
        const object = (kind === "us_state" ? topo.objects.states : topo.objects.countries) as GeometryCollection;
        const shapes = feature(topo, object) as Shapes;
        shapes.features = shapes.features.filter((f) => f.id !== "010");
        for (const f of shapes.features) {
          const g = f.geometry;
          if (g.type === "Polygon") unwrapRings(g.coordinates);
          else if (g.type === "MultiPolygon") g.coordinates.forEach(unwrapRings);
        }
        return shapes;
      })(),
    );
  }
  return shapeCache.get(kind)!;
}

const matchCache = new Map<string, GeoMatch | null>();
const keyOf = (kind: GeoKind, name: string, hint?: string | null) => `${kind}\u0000${name}\u0000${hint ?? ""}`;

export async function resolvePlaces(
  kind: GeoKind,
  items: { name: string; hint?: string | null }[],
): Promise<(GeoMatch | null)[]> {
  const missing = items.filter((i) => !matchCache.has(keyOf(kind, i.name, i.hint)));
  const unique = [...new Map(missing.map((i) => [keyOf(kind, i.name, i.hint), i])).values()];
  for (let i = 0; i < unique.length; i += 2000) {
    const batch = unique.slice(i, i + 2000);
    const { results } = await api.geoResolve(kind, batch);
    batch.forEach((it, j) => matchCache.set(keyOf(kind, it.name, it.hint), results[j] ?? null));
  }
  return items.map((i) => matchCache.get(keyOf(kind, i.name, i.hint)) ?? null);
}

const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

export function rampColor(ramp: readonly string[], t: number): string {
  const x = Math.min(1, Math.max(0, t)) * (ramp.length - 1);
  const i = Math.min(ramp.length - 2, Math.floor(x));
  const [a, b] = [hex(ramp[i]), hex(ramp[i + 1])];
  const f = x - i;
  return `rgb(${a.map((v, k) => Math.round(v + (b[k] - v) * f)).join(",")})`;
}

export const featureId = (f: Feature) => (f.id === undefined ? null : String(f.id));
