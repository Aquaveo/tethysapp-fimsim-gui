// reactapp/src/geo.ts
// Small geographic helpers for the AOI step — no turf dependency needed yet.
import type { Feature, FeatureCollection, Polygon, MultiPolygon, Position } from 'geojson';

export type AoiGeometry = Polygon | MultiPolygon;
export type AoiFeature = Feature<AoiGeometry>;

export interface Aoi {
  id: string;
  name: string;
  source: 'upload' | 'drawn' | 'example';
  feature: AoiFeature;
  areaKm2: number;
  inConus: boolean;
  /** LISFLOOD-FP/TRITON require rectangular AOIs. */
  isRect: boolean;
}

const R = 6378137; // WGS84 sphere, matches the common web-geo convention

/** Spherical ring area (m²), positive regardless of winding. */
function ringArea(ring: Position[]): number {
  let total = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [lon1, lat1] = ring[i];
    const [lon2, lat2] = ring[i + 1];
    total +=
      ((lon2 - lon1) * Math.PI / 180) *
      (2 + Math.sin((lat1 * Math.PI) / 180) + Math.sin((lat2 * Math.PI) / 180));
  }
  return Math.abs((total * R * R) / 2);
}

/** Spherical area in km², holes subtracted — drives the AOI size guardrails. */
export function areaKm2(geom: AoiGeometry): number {
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  let m2 = 0;
  for (const poly of polys) {
    m2 += ringArea(poly[0]);
    for (const hole of poly.slice(1)) m2 -= ringArea(hole);
  }
  return m2 / 1e6;
}

/** [minLon, minLat, maxLon, maxLat] over polygon features. */
export function boundsOf(features: AoiFeature[]): [number, number, number, number] | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const eat = (p: Position) => {
    if (p[0] < minX) minX = p[0];
    if (p[1] < minY) minY = p[1];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] > maxY) maxY = p[1];
  };
  for (const f of features) {
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const poly of polys) for (const ring of poly) for (const p of ring) eat(p);
  }
  return minX === Infinity ? null : [minX, minY, maxX, maxY];
}

/** Rough CONUS check (all data sources are US-only); real validation is server-side (FIMSIM-BE6). */
export function isInConus(geom: AoiGeometry): boolean {
  const b = boundsOf([{ type: 'Feature', properties: {}, geometry: geom }]);
  if (!b) return false;
  const [minX, minY, maxX, maxY] = b;
  return minX >= -125.5 && maxX <= -66 && minY >= 24 && maxY <= 50;
}

/** Split any FeatureCollection into one polygonal feature per AOI (desktop parity:
 *  each feature in the file becomes its own AOI). Non-polygon features are dropped. */
export function polygonFeatures(fc: FeatureCollection): AoiFeature[] {
  return fc.features.filter(
    (f): f is AoiFeature =>
      f.geometry?.type === 'Polygon' || f.geometry?.type === 'MultiPolygon',
  );
}

/** LISFLOOD-FP/TRITON require rectangular AOIs. A geometry counts as rectangular
 *  when it is a single 4-corner ring whose corners are all ~90° — measured in a
 *  local planar frame, so rectangles drawn in a projected CRS (e.g. the desktop
 *  test cases, rectangular in UTM but slightly rotated in lon/lat) still pass. */
export function isRectangular(geom: AoiGeometry, angleTolDeg = 8): boolean {
  if (geom.type !== 'Polygon' || geom.coordinates.length !== 1) return false;
  const ring = geom.coordinates[0];
  const closed =
    ring.length >= 2 &&
    ring[0][0] === ring[ring.length - 1][0] &&
    ring[0][1] === ring[ring.length - 1][1];
  const pts = closed ? ring.slice(0, -1) : ring;
  if (pts.length !== 4) return false;
  const midLat = (pts.reduce((s, p) => s + p[1], 0) / 4) * (Math.PI / 180);
  const kx = Math.cos(midLat); // local planar scale for longitude
  for (let i = 0; i < 4; i++) {
    const prev = pts[(i + 3) % 4];
    const cur = pts[i];
    const next = pts[(i + 1) % 4];
    const a = [(prev[0] - cur[0]) * kx, prev[1] - cur[1]];
    const b = [(next[0] - cur[0]) * kx, next[1] - cur[1]];
    const la = Math.hypot(a[0], a[1]);
    const lb = Math.hypot(b[0], b[1]);
    if (la === 0 || lb === 0) return false;
    const angle = (Math.acos(Math.min(1, Math.max(-1, (a[0] * b[0] + a[1] * b[1]) / (la * lb)))) * 180) / Math.PI;
    if (Math.abs(angle - 90) > angleTolDeg) return false;
  }
  return true;
}

/** The feature's axis-aligned bounding box as a Polygon feature (name preserved). */
export function bboxFeature(f: AoiFeature): AoiFeature {
  const b = boundsOf([f])!;
  return {
    type: 'Feature',
    properties: { ...f.properties },
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]], [b[0], b[1]],
      ]],
    },
  };
}
