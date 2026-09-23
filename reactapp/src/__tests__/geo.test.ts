// reactapp/src/__tests__/geo.test.ts — pure geographic helpers.
import { describe, expect, it } from 'vitest';
import type { FeatureCollection, Polygon } from 'geojson';
import {
  areaKm2, bboxFeature, boundsOf, isInConus, isRectangular, polygonFeatures,
  type AoiFeature, type AoiGeometry,
} from '../geo';

const feat = (geometry: AoiGeometry, name = 'x'): AoiFeature => ({
  type: 'Feature',
  properties: { name },
  geometry,
});

const box = (minX: number, minY: number, maxX: number, maxY: number): Polygon => ({
  type: 'Polygon',
  coordinates: [[
    [minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY], [minX, minY],
  ]],
});

describe('boundsOf', () => {
  it('returns [minLon, minLat, maxLon, maxLat] over multiple features', () => {
    expect(boundsOf([feat(box(-100, 35, -99, 36)), feat(box(-98, 30, -97, 31))]))
      .toEqual([-100, 30, -97, 36]);
  });

  it('walks MultiPolygons and holes too', () => {
    const geom: AoiGeometry = {
      type: 'MultiPolygon',
      coordinates: [box(0, 0, 1, 1).coordinates, box(5, 5, 6, 7).coordinates],
    };
    expect(boundsOf([feat(geom)])).toEqual([0, 0, 6, 7]);
  });

  it('returns null when there is nothing to measure', () => {
    expect(boundsOf([])).toBeNull();
  });
});

describe('areaKm2', () => {
  it('is ~124 km² for a 0.1°×0.1° box at the equator', () => {
    const a = areaKm2(box(0, 0, 0.1, 0.1));
    expect(a).toBeGreaterThan(122);
    expect(a).toBeLessThan(126);
  });

  it('subtracts holes', () => {
    const outer = box(0, 0, 0.1, 0.1).coordinates[0];
    const hole = box(0.02, 0.02, 0.08, 0.08).coordinates[0];
    const withHole = areaKm2({ type: 'Polygon', coordinates: [outer, hole] });
    expect(withHole).toBeLessThan(areaKm2(box(0, 0, 0.1, 0.1)));
    expect(withHole).toBeGreaterThan(0);
  });
});

describe('isInConus', () => {
  it('accepts a Kansas box and rejects Europe', () => {
    expect(isInConus(box(-100, 38, -99, 39))).toBe(true);
    expect(isInConus(box(5, 48, 6, 49))).toBe(false);
  });

  it('rejects a box straddling the CONUS edge', () => {
    expect(isInConus(box(-130, 38, -99, 39))).toBe(false);
  });
});

describe('isRectangular', () => {
  it('accepts an axis-aligned closed rectangle', () => {
    expect(isRectangular(box(-100, 35, -99, 36))).toBe(true);
  });

  it('accepts a rotated rectangle (projected-CRS rectangles arrive slightly rotated)', () => {
    // rotate the unit rectangle by 30° around the origin (equator, so kx≈1)
    const rot = (x: number, y: number): [number, number] => {
      const r = (30 * Math.PI) / 180;
      return [x * Math.cos(r) - y * Math.sin(r), x * Math.sin(r) + y * Math.cos(r)];
    };
    const ring = [rot(0, 0), rot(0.5, 0), rot(0.5, 0.25), rot(0, 0.25), rot(0, 0)];
    expect(isRectangular({ type: 'Polygon', coordinates: [ring] })).toBe(true);
  });

  it('rejects triangles, pentagons, holes, and MultiPolygons', () => {
    expect(isRectangular({
      type: 'Polygon', coordinates: [[[0, 0], [1, 0], [0.5, 1], [0, 0]]],
    })).toBe(false);
    expect(isRectangular({
      type: 'Polygon', coordinates: [[[0, 0], [2, 0], [2.5, 1], [2, 2], [0, 2], [0, 0]]],
    })).toBe(false);
    const outer = box(0, 0, 1, 1).coordinates[0];
    const hole = box(0.2, 0.2, 0.8, 0.8).coordinates[0];
    expect(isRectangular({ type: 'Polygon', coordinates: [outer, hole] })).toBe(false);
    expect(isRectangular({
      type: 'MultiPolygon', coordinates: [box(0, 0, 1, 1).coordinates],
    })).toBe(false);
  });
});

describe('polygonFeatures', () => {
  it('keeps Polygon/MultiPolygon features and drops everything else', () => {
    const fc: FeatureCollection = {
      type: 'FeatureCollection',
      features: [
        feat(box(0, 0, 1, 1)),
        { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [0, 0] } },
        { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } },
      ],
    };
    const kept = polygonFeatures(fc);
    expect(kept).toHaveLength(1);
    expect(kept[0].geometry.type).toBe('Polygon');
  });
});

describe('bboxFeature', () => {
  it('produces the closed axis-aligned bounding box, preserving properties', () => {
    const tri: AoiGeometry = {
      type: 'Polygon', coordinates: [[[0, 0], [2, 0], [1, 3], [0, 0]]],
    };
    const out = bboxFeature(feat(tri, 'my aoi'));
    expect(out.properties).toEqual({ name: 'my aoi' });
    expect(out.geometry).toEqual({
      type: 'Polygon',
      coordinates: [[[0, 0], [2, 0], [2, 3], [0, 3], [0, 0]]],
    });
  });
});
