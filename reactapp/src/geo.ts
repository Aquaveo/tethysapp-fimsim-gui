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
