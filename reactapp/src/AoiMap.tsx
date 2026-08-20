// reactapp/src/AoiMap.tsx
// The AOI map: Esri basemap toggle (family pattern: FIMeval's ContingencyMap),
// the confirmed AOI layer, and a lightweight click-to-vertex polygon draw mode
// (click to add vertices, double-click to finish, Esc to cancel).
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

interface Props {
  aois: Aoi[];
  drawing: boolean;
  onDrawComplete: (ring: Position[]) => void;
  onDrawCancel: () => void;
  /** Bumps when the user asks to zoom to an AOI. */
  zoomTo?: Aoi | null;
}

export default function AoiMap({ aois, drawing, onDrawComplete, onDrawCancel, zoomTo }: Props) {
  const container = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [ready, setReady] = useState(false);
  const [basemap, setBasemap] = useState<(typeof BASEMAPS)[number]['key']>('satellite');
  // Draw state lives in refs — map handlers must see current values without rebinding.
  const verts = useRef<Position[]>([]);
  const drawingRef = useRef(drawing);
  const completeRef = useRef(onDrawComplete);
  const cancelRef = useRef(onDrawCancel);
  drawingRef.current = drawing;
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
            id: 'draft-line', type: 'line', source: 'draft',
            filter: ['==', '$type', 'LineString'],
            paint: { 'line-color': '#FFC107', 'line-width': 2, 'line-dasharray': [2, 1.5] },
          },
          {
            id: 'draft-pts', type: 'circle', source: 'draft',
            filter: ['==', '$type', 'Point'],
            paint: { 'circle-radius': 4.5, 'circle-color': '#FFC107', 'circle-stroke-color': '#152428', 'circle-stroke-width': 1 },
          },
        ],
      },
      bounds: CONUS_BOUNDS,
      fitBoundsOptions: { padding: 20 },
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl(), 'top-right');
    map.on('load', () => setReady(true));

    const draftFC = (): FeatureCollection => {
      const pts: Feature[] = verts.current.map((p) => ({
        type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: p },
      }));
      const line: Feature[] = verts.current.length >= 2
        ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: verts.current } }]
        : [];
      return { type: 'FeatureCollection', features: [...pts, ...line] };
    };
    const refreshDraft = () =>
      (map.getSource('draft') as maplibregl.GeoJSONSource | undefined)?.setData(draftFC());

    map.on('click', (e) => {
      if (!drawingRef.current) return;
      verts.current = [...verts.current, [e.lngLat.lng, e.lngLat.lat]];
      refreshDraft();
    });
    map.on('dblclick', (e) => {
      if (!drawingRef.current) return;
      e.preventDefault();
      // The double-click already delivered two click events at the same spot — drop one.
      const ring = verts.current.slice(0, -1);
      verts.current = [];
      refreshDraft();
      if (ring.length >= 3) {
        completeRef.current([...ring, ring[0]]);
      } else {
        cancelRef.current();
      }
    });
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape' && drawingRef.current) {
        verts.current = [];
        refreshDraft();
        cancelRef.current();
      }
    };
    window.addEventListener('keydown', onKey);

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
    if (!drawing) {
      verts.current = [];
      (map.getSource('draft') as maplibregl.GeoJSONSource | undefined)?.setData(EMPTY_FC);
    }
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
          Click to add vertices · double-click to finish · Esc to cancel
        </div>
      )}
    </div>
  );
}
