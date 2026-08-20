// reactapp/src/AoiStep.tsx
// The Area of Interest step: upload a zipped shapefile or GeoJSON (parsed
// client-side for now — the server-side upload endpoint is FIMSIM-BE6), draw a
// polygon on the map, or load the bundled Neuse example. Every polygonal
// feature becomes its own AOI (desktop parity with multi_aoi.inspect_features).
import { useRef, useState } from 'react';
import type { Position } from 'geojson';
import shp from 'shpjs';
import AoiMap from './AoiMap';
import { NEUSE_AOI } from './exampleAois';
import { areaKm2, isInConus, polygonFeatures, type Aoi, type AoiFeature } from './geo';
import './AoiStep.css';

interface Props {
  aois: Aoi[];
  setAois: (next: Aoi[]) => void;
}

let nextId = 1;
const makeAoi = (feature: AoiFeature, name: string, source: Aoi['source']): Aoi => ({
  id: `aoi-${nextId++}`,
  name,
  source,
  feature,
  areaKm2: areaKm2(feature.geometry),
  inConus: isInConus(feature.geometry),
});

export default function AoiStep({ aois, setAois }: Props) {
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zoomTo, setZoomTo] = useState<Aoi | null>(null);

  const addFeatures = (features: AoiFeature[], baseName: string, source: Aoi['source']) => {
    if (!features.length) {
      setError(`No polygon features found in ${baseName}.`);
      return;
    }
    const named = features.map((f, i) => {
      const propName =
        (typeof f.properties?.name === 'string' && f.properties.name) ||
        (typeof f.properties?.Name === 'string' && f.properties.Name);
      const name = propName || (features.length > 1 ? `${baseName} — feature ${i + 1}` : baseName);
      return makeAoi(f, name, source);
    });
    setAois([...aois, ...named]);
    setError(null);
  };

  const handleFile = async (file: File) => {
    setError(null);
    const lower = file.name.toLowerCase();
    try {
      if (lower.endsWith('.geojson') || lower.endsWith('.json')) {
        const fc = JSON.parse(await file.text());
        addFeatures(polygonFeatures(fc), file.name, 'upload');
      } else if (lower.endsWith('.zip')) {
        const parsed = await shp(await file.arrayBuffer());
        const collections = Array.isArray(parsed) ? parsed : [parsed];
        addFeatures(collections.flatMap(polygonFeatures), file.name, 'upload');
      } else if (lower.endsWith('.gpkg')) {
        setError(
          'GeoPackage parsing arrives with the server-side upload (FIMSIM-BE6). ' +
          'For now, use a zipped shapefile (.zip) or GeoJSON.',
        );
      } else {
        setError('Unsupported file type. Upload a zipped shapefile (.zip), .geojson, or .json.');
      }
    } catch (err) {
      setError(`Could not read ${file.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const onDrawComplete = (ring: Position[]) => {
    setDrawing(false);
    const feature: AoiFeature = {
      type: 'Feature',
      properties: {},
      geometry: { type: 'Polygon', coordinates: [ring] },
    };
    const drawnCount = aois.filter((a) => a.source === 'drawn').length + 1;
    addFeatures([feature], `Drawn AOI ${drawnCount}`, 'drawn');
  };

  const remove = (id: string) => setAois(aois.filter((a) => a.id !== id));

  return (
    <div className="as-wrap">
      <div className="as-actions">
        <button type="button" className="button-primary" onClick={() => fileInput.current?.click()}>
          Upload area file
        </button>
        <button
          type="button"
          className={drawing ? 'button-primary' : 'button-secondary'}
          onClick={() => setDrawing(!drawing)}
        >
          {drawing ? 'Cancel drawing' : 'Draw on map'}
        </button>
        <button
          type="button"
          className="button-secondary"
          onClick={() => addFeatures([NEUSE_AOI], 'Neuse River, NC (example)', 'example')}
        >
          Load example: Neuse River, NC
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".zip,.geojson,.json,.gpkg"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
            e.target.value = '';
          }}
        />
      </div>
      <p className="as-hint">
        Zipped shapefile (.zip) or GeoJSON — every polygon feature becomes its own study area.
      </p>

      {error && <div className="as-error" role="alert">{error}</div>}

      <AoiMap
        aois={aois}
        drawing={drawing}
        onDrawComplete={onDrawComplete}
        onDrawCancel={() => setDrawing(false)}
        zoomTo={zoomTo}
      />

      {aois.length > 0 && (
        <ul className="as-cards">
          {aois.map((a) => (
            <li key={a.id} className="as-card">
              <button type="button" className="as-card-main" onClick={() => setZoomTo(a)} title="Zoom to this area">
                <span className="as-card-name">{a.name}</span>
                <span className="as-card-meta">
                  {a.areaKm2 >= 1 ? a.areaKm2.toFixed(1) : a.areaKm2.toFixed(3)} km²
                  {' · '}
                  {a.source}
                </span>
                {!a.inConus && (
                  <span className="as-card-warn">
                    Outside the continental US — data sources are US-only
                  </span>
                )}
              </button>
              <button type="button" className="as-card-x" aria-label={`Remove ${a.name}`} onClick={() => remove(a.id)}>
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
