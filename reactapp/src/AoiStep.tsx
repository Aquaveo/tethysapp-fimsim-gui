// reactapp/src/AoiStep.tsx
// The Area of Interest step, server-backed (FIMSIM-BE6 cutover): uploads go
// to the ingest endpoint (zipped shapefile / GeoPackage / GeoJSON — every
// polygon feature becomes its own AOI, validated server-side), drawn
// rectangles POST as GeoJSON, and each AOI's context lookup (river, gages,
// flowlines) runs as a background job whose status the cards poll.
import { useEffect, useRef, useState } from 'react';
import type { Position } from 'geojson';
import AoiMap from './AoiMap';
import {
  ApiError, createDrawnAoi, deleteAoi, getAoi, uploadAoiFile,
  retryLookup, type ServerAoi,
} from './api';
import { NEUSE_AOI } from './exampleAois';
import './AoiStep.css';

interface Props {
  projectId: number;
  aois: ServerAoi[];
  setAois: (updater: (prev: ServerAoi[]) => ServerAoi[]) => void;
}

const LOOKUP_POLL_MS = 4000;

export default function AoiStep({ projectId, aois, setAois }: Props) {
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoomTo, setZoomTo] = useState<ServerAoi | null>(null);

  // ── lookup polling: refresh any AOI whose lookup is still in flight ──
  useEffect(() => {
    const pending = aois.filter((a) => ['pending', 'running'].includes(a.lookup_status));
    if (!pending.length) return;
    const t = setInterval(async () => {
      for (const a of pending) {
        try {
          const fresh = await getAoi(a.id);
          setAois((prev) => prev.map((x) => (x.id === fresh.id ? fresh : x)));
        } catch {
          /* transient — next tick retries */
        }
      }
    }, LOOKUP_POLL_MS);
    return () => clearInterval(t);
  }, [aois, setAois]);

  const fail = (e: unknown) =>
    setError(e instanceof ApiError ? e.message : String((e as Error).message ?? e));

  const addAois = (created: ServerAoi[]) =>
    setAois((prev) => [...prev, ...created]);

  const handleFile = async (file: File) => {
    setError(null);
    setBusy(`Uploading ${file.name}…`);
    try {
      const res = await uploadAoiFile(projectId, file);
      addAois(res.aois);
      if (res.skipped_non_polygon) {
        setError(`${res.skipped_non_polygon} non-polygon feature(s) were skipped.`);
      }
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const onDrawComplete = async (ring: Position[]) => {
    setDrawing(false);
    setBusy('Saving drawn area…');
    setError(null);
    try {
      const n = aois.filter((a) => a.source === 'drawn').length + 1;
      const res = await createDrawnAoi(
        projectId, { type: 'Polygon', coordinates: [ring] }, `Drawn AOI ${n}`);
      addAois(res.aois);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const loadExample = async () => {
    setBusy('Adding example…');
    setError(null);
    try {
      const res = await createDrawnAoi(
        projectId, NEUSE_AOI.geometry as GeoJSON.Polygon,
        'Neuse River, NC (example)', 'example');
      addAois(res.aois);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const remove = async (a: ServerAoi) => {
    try {
      await deleteAoi(a.id);
      setAois((prev) => prev.filter((x) => x.id !== a.id));
    } catch (e) {
      fail(e);
    }
  };

  const useBbox = async (a: ServerAoi) => {
    // LISFLOOD-FP/TRITON require rectangles: replace with the bounding box.
    const coords = a.geometry.coordinates.flat();
    const xs = coords.map((p) => p[0]);
    const ys = coords.map((p) => p[1]);
    const [minX, maxX] = [Math.min(...xs), Math.max(...xs)];
    const [minY, maxY] = [Math.min(...ys), Math.max(...ys)];
    const ring: Position[] = [
      [minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY], [minX, minY],
    ];
    setBusy('Replacing with bounding box…');
    try {
      const res = await createDrawnAoi(
        projectId, { type: 'Polygon', coordinates: [ring] }, a.name, 'drawn');
      await deleteAoi(a.id);
      setAois((prev) => [...prev.filter((x) => x.id !== a.id), ...res.aois]);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const retry = async (a: ServerAoi) => {
    try {
      const fresh = await retryLookup(a.id);
      setAois((prev) => prev.map((x) => (x.id === fresh.id ? fresh : x)));
    } catch (e) {
      fail(e);
    }
  };

  return (
    <div className="as-wrap">
      <div className="as-actions">
        <button
          type="button" className="button-primary"
          disabled={!!busy}
          onClick={() => fileInput.current?.click()}
        >
          Upload area file
        </button>
        <button
          type="button"
          className={drawing ? 'button-primary' : 'button-secondary'}
          disabled={!!busy}
          onClick={() => setDrawing(!drawing)}
        >
          {drawing ? 'Cancel drawing' : 'Draw on map'}
        </button>
        <button type="button" className="button-secondary" disabled={!!busy} onClick={() => void loadExample()}>
          Load example: Neuse River, NC
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".zip,.gpkg,.geojson,.json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
            e.target.value = '';
          }}
        />
      </div>
      <p className="as-hint">
        Zipped shapefile (.zip), GeoPackage (.gpkg), or GeoJSON — every polygon
        feature becomes its own study area, validated on the server.
        LISFLOOD-FP and TRITON require <strong>rectangular</strong> areas;
        drawing produces a rectangle, and non-rectangular uploads can be
        converted to their bounding box.
      </p>

      {busy && <div className="as-busy" role="status">{busy}</div>}
      {error && <div className="as-error" role="alert">{error}</div>}

      <AoiMap
        aois={aois}
        drawing={drawing}
        onDrawComplete={(ring) => void onDrawComplete(ring)}
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
                  {a.area_km2 >= 1 ? a.area_km2.toFixed(1) : a.area_km2.toFixed(3)} km²
                  {' · '}{a.source}
                  {a.states?.length ? ` · ${a.states.map((s) => s.abbr ?? s.name).join(', ')}` : ''}
                  {a.huc8_codes?.length ? ` · HUC8 ${a.huc8_codes.join(', ')}` : ''}
                </span>
                <span className="as-card-lookup">
                  {a.lookup_status === 'done' ? (
                    <>
                      River: <strong>{a.river_name ?? 'none detected'}</strong>
                      {' · '}{a.lookup?.gages?.length ?? 0} gage{(a.lookup?.gages?.length ?? 0) === 1 ? '' : 's'}
                    </>
                  ) : a.lookup_status === 'failed' ? (
                    <span className="as-card-warn">River/gage lookup failed</span>
                  ) : (
                    <span className="as-card-resolving">Resolving river &amp; gages…</span>
                  )}
                </span>
                {!a.is_rectangular && (
                  <span className="as-card-warn">
                    Not rectangular — LISFLOOD-FP/TRITON require rectangular areas
                  </span>
                )}
              </button>
              {a.lookup_status === 'failed' && (
                <button type="button" className="as-card-fix" onClick={() => void retry(a)}>
                  Retry lookup
                </button>
              )}
              {!a.is_rectangular && (
                <button
                  type="button" className="as-card-fix"
                  onClick={() => void useBbox(a)}
                  title="Replace this area with its bounding box"
                >
                  Use bounding box
                </button>
              )}
              <button type="button" className="as-card-x" aria-label={`Remove ${a.name}`} onClick={() => void remove(a)}>
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
