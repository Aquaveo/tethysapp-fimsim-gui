// reactapp/src/AoiMap.tsx
// The AOI map: Esri basemap toggle (family pattern: FIMeval's ContingencyMap),
// the confirmed AOI layer, and a draw mode. LISFLOOD-FP/TRITON require
// rectangular AOIs (Aug 2026 meeting decision), so the default draw is a
// two-click rectangle; the free-polygon mode stays available via `drawMode`
// for post-MVP models (HAND-FIM, ARC) that accept arbitrary shapes.
import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// maplibre resolves its worker via `new URL(...)`, which Vite's static analysis
// can't see in the minified build — import it explicitly so production works.
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import type { Feature, FeatureCollection, Position } from 'geojson';
import type { Aoi } from './geo';
import { boundsOf } from './geo';
import './AoiMap.css';

maplibregl.setWorkerUrl(maplibreWorkerUrl);

const BASEMAPS = [
  {
    key: 'satellite',
    label: 'Satellite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Esri, Maxar, Earthstar Geographics',
  },
  {
    key: 'street',
    label: 'Street',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Esri, HERE, Garmin, USGS, EPA',
  },
] as const;

const CONUS_BOUNDS: [[number, number], [number, number]] = [[-125.5, 24], [-66, 50]];
const EMPTY_FC: FeatureCollection = { type: 'FeatureCollection', features: [] };

export type DrawMode = 'rectangle' | 'polygon';

/** Closed axis-aligned ring from two opposite corners. */
function rectRing(a: Position, b: Position): Position[] {
  const [minX, maxX] = a[0] < b[0] ? [a[0], b[0]] : [b[0], a[0]];
  const [minY, maxY] = a[1] < b[1] ? [a[1], b[1]] : [b[1], a[1]];
  return [[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY], [minX, minY]];
}

interface Props {
  aois: Aoi[];
  drawing: boolean;
  drawMode?: DrawMode;
  onDrawComplete: (ring: Position[]) => void;
  onDrawCancel: () => void;
  /** Bumps when the user asks to zoom to an AOI. */
  zoomTo?: Aoi | null;
}

export default function AoiMap({
  aois,
  drawing,
  drawMode = 'rectangle',
  onDrawComplete,
  onDrawCancel,
  zoomTo,
}: Props) {
  const container = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [ready, setReady] = useState(false);
  const [basemap, setBasemap] = useState<(typeof BASEMAPS)[number]['key']>('satellite');
  // Draw state lives in refs — map handlers must see current values without rebinding.
  const verts = useRef<Position[]>([]);
  const drawingRef = useRef(drawing);
  const modeRef = useRef<DrawMode>(drawMode);
  const completeRef = useRef(onDrawComplete);
  const cancelRef = useRef(onDrawCancel);
  const resetDraftRef = useRef<() => void>(() => {});
  drawingRef.current = drawing;
  modeRef.current = drawMode;
  completeRef.current = onDrawComplete;
  cancelRef.current = onDrawCancel;

  // ── Build the map once ──
  useEffect(() => {
    if (!container.current) return;
    const map = new maplibregl.Map({
      container: container.current,
      style: {
        version: 8,
        sources: {
          basemap: {
            type: 'raster',
            tiles: [BASEMAPS[0].url],
            tileSize: 256,
            attribution: BASEMAPS[0].attribution,
          },
          aois: { type: 'geojson', data: EMPTY_FC },
          draft: { type: 'geojson', data: EMPTY_FC },
        },
        layers: [
          { id: 'basemap', type: 'raster', source: 'basemap' },
          {
            id: 'aoi-fill', type: 'fill', source: 'aois',
            paint: { 'fill-color': '#25C2DF', 'fill-opacity': 0.18 },
          },
          {
            id: 'aoi-line', type: 'line', source: 'aois',
            paint: { 'line-color': '#25C2DF', 'line-width': 2.5 },
          },
          {
            id: 'draft-fill', type: 'fill', source: 'draft',
            filter: ['==', '$type', 'Polygon'],
            paint: { 'fill-color': '#FFC107', 'fill-opacity': 0.12 },
          },
          {
            id: 'draft-line', type: 'line', source: 'draft',
            filter: ['==', '$type', 'LineString'],
            paint: { 'line-color': '#FFC107', 'line-width': 2, 'line-dasharray': [2, 1.5] },
          },
          {
            // Polygon mode: first vertex grows into a snap target once the ring can close.
            id: 'draft-pts', type: 'circle', source: 'draft',
            filter: ['==', '$type', 'Point'],
            paint: {
              'circle-radius': ['case', ['boolean', ['get', 'closable'], false], 7.5, 4.5],
              'circle-color': ['case', ['boolean', ['get', 'closable'], false], '#ffffff', '#FFC107'],
              'circle-stroke-color': ['case', ['boolean', ['get', 'closable'], false], '#FFC107', '#152428'],
              'circle-stroke-width': ['case', ['boolean', ['get', 'closable'], false], 2.5, 1],
            },
          },
        ],
      },
      bounds: CONUS_BOUNDS,
      fitBoundsOptions: { padding: 20 },
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl(), 'top-right');
    map.on('load', () => setReady(true));

    const cursor = { current: null as Position | null };

    const draftFC = (): FeatureCollection => {
      const v = verts.current;
      const features: Feature[] = [];

      if (modeRef.current === 'rectangle') {
        // Anchor corner + ghost rectangle to the cursor.
        if (v.length >= 1) {
          features.push({
            type: 'Feature', properties: {},
            geometry: { type: 'Point', coordinates: v[0] },
          });
          if (cursor.current) {
            const ring = rectRing(v[0], cursor.current);
            features.push(
              { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: ring } },
              { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } },
            );
          }
        }
        return { type: 'FeatureCollection', features };
      }

      // Polygon mode.
      const canClose = v.length >= 3;
      for (let i = 0; i < v.length; i++) {
        features.push({
          type: 'Feature',
          properties: { closable: canClose && i === 0 },
          geometry: { type: 'Point', coordinates: v[i] },
        });
      }
      if (v.length >= 2) {
        features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: v } });
      }
      if (v.length >= 1 && cursor.current) {
        const ghost: Position[] = canClose
          ? [v[v.length - 1], cursor.current, v[0]]
          : [v[v.length - 1], cursor.current];
        features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: ghost } });
      }
      if (canClose) {
        features.push({
          type: 'Feature', properties: {},
          geometry: { type: 'Polygon', coordinates: [[...v, ...(cursor.current ? [cursor.current] : []), v[0]]] },
        });
      }
      return { type: 'FeatureCollection', features };
    };
    const refreshDraft = () =>
      (map.getSource('draft') as maplibregl.GeoJSONSource | undefined)?.setData(draftFC());

    const finish = (ring: Position[]) => {
      verts.current = [];
      cursor.current = null;
      refreshDraft();
      completeRef.current(ring);
    };
    const reset = (cancel: boolean) => {
      verts.current = [];
      cursor.current = null;
      refreshDraft();
      if (cancel) cancelRef.current();
    };

    map.on('click', (e) => {
      if (!drawingRef.current) return;
      const p: Position = [e.lngLat.lng, e.lngLat.lat];

      if (modeRef.current === 'rectangle') {
        if (verts.current.length === 0) {
          verts.current = [p];
          refreshDraft();
        } else {
          finish(rectRing(verts.current[0], p));
        }
        return;
      }

      // Polygon mode: clicking the first vertex (within 12px) closes the ring.
      if (verts.current.length >= 3) {
        const first = map.project([verts.current[0][0], verts.current[0][1]]);
        if (Math.hypot(first.x - e.point.x, first.y - e.point.y) <= 12) {
          const ring = verts.current;
          finish([...ring, ring[0]]);
          return;
        }
      }
      verts.current = [...verts.current, p];
      refreshDraft();
    });

    map.on('mousemove', (e) => {
      if (!drawingRef.current || verts.current.length === 0) return;
      cursor.current = [e.lngLat.lng, e.lngLat.lat];
      refreshDraft();
    });

    map.on('dblclick', (e) => {
      if (!drawingRef.current || modeRef.current !== 'polygon') return;
      e.preventDefault();
      // The double-click already delivered two click events at the same spot — drop one.
      const ring = verts.current.slice(0, -1);
      if (ring.length >= 3) {
        finish([...ring, ring[0]]);
      } else {
        reset(true);
      }
    });

    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape' && drawingRef.current) reset(true);
    };
    window.addEventListener('keydown', onKey);

    // Drawing-mode reset needs access to reset(); expose via ref-free closure.
    resetDraftRef.current = () => reset(false);

    mapRef.current = map;
    return () => {
      window.removeEventListener('keydown', onKey);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // ── Drawing mode toggles cursor + double-click zoom ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.getCanvas().style.cursor = drawing ? 'crosshair' : '';
    if (drawing) map.doubleClickZoom.disable();
    else map.doubleClickZoom.enable();
    if (!drawing) resetDraftRef.current();
  }, [drawing, ready]);

  // ── Keep the AOI layer in sync; fit view when the set changes ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const fc: FeatureCollection = { type: 'FeatureCollection', features: aois.map((a) => a.feature) };
    (map.getSource('aois') as maplibregl.GeoJSONSource | undefined)?.setData(fc);
    const b = boundsOf(aois.map((a) => a.feature));
    if (b) map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 60, maxZoom: 12, duration: 600 });
  }, [aois, ready]);

  // ── Zoom-to request from an AOI card ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !zoomTo) return;
    const b = boundsOf([zoomTo.feature]);
    if (b) map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 60, maxZoom: 13, duration: 600 });
  }, [zoomTo, ready]);

  // ── Basemap toggle (swap tiles in place, family pattern) ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const bm = BASEMAPS.find((b) => b.key === basemap)!;
    const src = map.getSource('basemap') as maplibregl.RasterTileSource | undefined;
    src?.setTiles([bm.url]);
  }, [basemap, ready]);

  return (
    <div className="am-wrap">
      <div ref={container} className="am-map" />
      <div className="am-basemaps" role="group" aria-label="Basemap">
        {BASEMAPS.map((b) => (
          <button
            key={b.key}
            type="button"
            className={'am-bm-btn' + (basemap === b.key ? ' is-active' : '')}
            onClick={() => setBasemap(b.key)}
          >
            {b.label}
          </button>
        ))}
      </div>
      {drawing && (
        <div className="am-draw-hint" role="status">
          {drawMode === 'rectangle'
            ? 'Click to set the first corner · click again to finish the rectangle · Esc to cancel'
            : 'Click to add vertices · click the first point (or double-click) to finish · Esc to cancel'}
        </div>
      )}
    </div>
  );
}
