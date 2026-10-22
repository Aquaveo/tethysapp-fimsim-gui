// reactapp/src/AoiStep.tsx
// The Area of Interest step, server-backed (FIMSIM-BE6 cutover): uploads go
// to the ingest endpoint (zipped shapefile / GeoPackage / GeoJSON, validated
// server-side), drawn rectangles POST as GeoJSON, and each AOI's context
// lookup (river, gages, flowlines) runs as a background job whose status the
// cards poll. #xi: ONE study area per project — a multi-feature file offers a
// single choice, and adding an area when one exists replaces it (confirmed).
import { useEffect, useRef, useState } from 'react';
import type { Position } from 'geojson';
import AoiMap from './AoiMap';
import ConfirmDialog from './ConfirmDialog';
import {
  ApiError, createDrawnAoi, deleteAoi, getAoi, previewAoiFile, uploadAoiFile,
  retryLookup, type PreviewFeature, type ServerAoi,
} from './api';
import { defaultPick, needsReplaceConfirm, replaceWarning } from './aoiRules';
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
  // FE31/#xi: a multi-feature upload waiting for the user to pick ONE feature
  const [pending, setPending] = useState<{ file: File; features: PreviewFeature[] } | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [zoomTo, setZoomTo] = useState<ServerAoi | null>(null);
  // #xi: an add that would replace the current area, awaiting confirmation
  const [replaceAsk, setReplaceAsk] = useState<{ run: () => Promise<void> } | null>(null);

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

  // #xi: with replace, the server has deleted the previous area(s) — the
  // created list IS the project's areas now
  const replaceAois = (created: ServerAoi[]) => setAois(() => created);

  // run an add now, or ask first when it would replace the current area
  const addOrAsk = (run: () => Promise<void>) => {
    if (needsReplaceConfirm(aois.length)) setReplaceAsk({ run });
    else void run();
  };

  const createFromUpload = async (file: File, indices?: number[]) => {
    const res = await uploadAoiFile(projectId, file, indices, aois.length > 0);
    replaceAois(res.aois);
    if (res.skipped_non_polygon) {
      setError(`${res.skipped_non_polygon} non-polygon feature(s) were skipped.`);
    }
  };

  const handleFile = async (file: File) => {
    setError(null);
    setBusy(`Reading ${file.name}…`);
    try {
      const { features } = await previewAoiFile(projectId, file);
      if (features.length <= 1) {
        // single feature: add it (replacing the current area after a confirm)
        addOrAsk(async () => {
          setBusy(`Adding ${file.name}…`);
          try { await createFromUpload(file); } catch (e) { fail(e); } finally { setBusy(null); }
        });
      } else {
        setPending({ file, features });      // multi-feature: pick ONE
        setPicked(defaultPick(features));
      }
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const confirmPending = () => {
    if (!pending || picked === null) return;
    const { file } = pending;
    const index = picked;
    addOrAsk(async () => {
      setError(null);
      setBusy('Adding the selected area…');
      try {
        await createFromUpload(file, [index]);
        setPending(null);
      } catch (e) {
        fail(e);
      } finally {
        setBusy(null);
      }
    });
  };

  const createDrawn = async (geometry: GeoJSON.Polygon, name: string,
                             source: 'drawn' | 'example', label: string) => {
    setBusy(label);
    setError(null);
    try {
      const res = await createDrawnAoi(projectId, geometry, name, source, aois.length > 0);
      replaceAois(res.aois);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const onDrawComplete = (ring: Position[]) => {
    setDrawing(false);
    addOrAsk(() => createDrawn(
      { type: 'Polygon', coordinates: [ring] }, 'Drawn AOI', 'drawn', 'Saving drawn area…'));
  };

  const loadExample = () => addOrAsk(() => createDrawn(
    NEUSE_AOI.geometry as GeoJSON.Polygon, 'Neuse River, NC (example)', 'example',
    'Adding example…'));

  const remove = async (a: ServerAoi) => {
    try {
      await deleteAoi(a.id);
      setAois((prev) => prev.filter((x) => x.id !== a.id));
    } catch (e) {
      fail(e);
    }
  };

  // "use" prefix reads as a hook to the linter — named replaceWithBbox instead.
  const replaceWithBbox = async (a: ServerAoi) => {
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
      // #xi: replace=true — the server swaps the area out in one request
      const res = await createDrawnAoi(
        projectId, { type: 'Polygon', coordinates: [ring] }, a.name, 'drawn', true);
      replaceAois(res.aois);
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
        <button type="button" className="button-secondary" disabled={!!busy} onClick={loadExample}>
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
        Zipped shapefile (.zip), GeoPackage (.gpkg), or GeoJSON, validated on
        the server. <strong>One study area per project</strong> — a file with
        several polygons lets you pick one; for many areas at once, use the
        desktop FIMsim.
        LISFLOOD-FP and TRITON require <strong>rectangular</strong> areas: click
        the corners on the map and the drawn shape closes into its smallest
        enclosing rectangle; non-rectangular uploads can be converted to their
        bounding box.
      </p>

      {busy && <div className="as-busy" role="status">{busy}</div>}
      {error && <div className="as-error" role="alert">{error}</div>}

      {pending && (
        <div className="as-picker" role="radiogroup" aria-label="Choose the study area">
          <div className="as-picker-head">
            <strong>{pending.file.name}</strong> has {pending.features.length} polygons.
            Choose <strong>one</strong> as the study area:
          </div>
          <ul className="as-picker-list">
            {pending.features.map((f) => (
              <li key={f.index}>
                <label>
                  <input type="radio" name="as-pick" checked={picked === f.index}
                         onChange={() => setPicked(f.index)} />
                  <span className="as-picker-name">{f.name}</span>
                  <span className="as-picker-meta">
                    {f.area_km2.toLocaleString()} km²
                    {' · '}{f.is_rectangular ? 'rectangular' : 'irregular'}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <div className="as-picker-actions">
            <button type="button" className="button-secondary"
                    disabled={!!busy} onClick={() => setPending(null)}>
              Cancel
            </button>
            <button type="button" className="button-primary"
                    disabled={!!busy || picked === null}
                    onClick={confirmPending}>
              Use this area
            </button>
          </div>
        </div>
      )}

      {replaceAsk && (
        <ConfirmDialog
          title="Replace the current study area?"
          confirmLabel="Replace it"
          cancelLabel="Keep the current area"
          onConfirm={() => { const { run } = replaceAsk; setReplaceAsk(null); void run(); }}
          onCancel={() => setReplaceAsk(null)}
        >
          <p>{replaceWarning(aois)}</p>
          <p>The web app runs one study area per project. To keep this one, start a new project instead.</p>
        </ConfirmDialog>
      )}

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
                  onClick={() => void replaceWithBbox(a)}
                  title="Replace this area with its bounding box"
                >
                  Use bounding box
                </button>
              )}
              <button type="button" className="as-card-x" aria-label={`Remove ${a.name}`} onClick={() => void remove(a)}>
                ✕
              </button>
              {a.lookup_status === 'done' && (
                <dl className="as-details">
                  <div><dt>Area</dt>
                    <dd>{a.area_km2 >= 1 ? a.area_km2.toFixed(1) : a.area_km2.toFixed(3)} km²</dd></div>
                  <div><dt>CRS</dt>
                    <dd>{a.working_crs_epsg ? `EPSG:${a.working_crs_epsg}` : '—'}</dd></div>
                  <div><dt>State</dt>
                    <dd>{a.states?.length ? a.states.map((s) => s.name).join(', ') : '—'}</dd></div>
                  <div><dt>HUC6</dt>
                    <dd>{a.huc6_codes?.length ? a.huc6_codes.join(', ') : '—'}</dd></div>
                  <div><dt>HUC8</dt>
                    <dd>{a.huc8_codes?.length ? a.huc8_codes.join(', ') : '—'}</dd></div>
                  <div><dt>Main river</dt>
                    <dd>{a.river_name ?? 'none detected'}</dd></div>
                  <div><dt>USGS gages in AOI</dt>
                    <dd>{a.lookup?.gages?.length ?? 0} found</dd></div>
                  {(a.lookup?.gages ?? []).map((g) => (
                    <div className="as-gage" key={g.site_no}>
                      <dt>{g.site_no}</dt><dd>{g.station_nm}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
