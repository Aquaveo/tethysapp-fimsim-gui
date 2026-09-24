// reactapp/src/ResultsStep.tsx
// FE8: the payoff screen. Flood overlay on the map (served same-origin —
// MinIO presigned URLs are CORS-blocked for fetch/MapLibre), the hydrograph
// recap, and a full outputs table across EVERY step with descriptions and a
// per-area Download All zip.
import { useEffect, useState } from 'react';
import AoiMap, { type MapOverlay } from './AoiMap';
import HydrographChart from './HydrographChart';
import { downloadSelectedZip, getStepRun, type ServerAoi, type ServerStepRun } from './api';
import {
  fileProxyUrl, formatBytes, keepModelSteps, outputMeta, summarizeSelection,
} from './outputsMeta';
import './StepPanel.css';
import './ResultsStep.css';

const STEP_LABELS: Record<string, string> = {
  dem: 'Terrain', manning: 'Roughness', bci: 'Boundaries',
  bdy: 'Flow Data', par: 'Settings', run: 'Simulation',
  tdem: 'Terrain', tfric: 'Friction', tbc: 'Boundaries',
  thyg: 'Hydrograph', tcfg: 'Config',
};

interface FileRow {
  step: string;
  runId: number;
  name: string;
  bytes: number;
}

interface AoiResult {
  aoi: ServerAoi;
  runStatus: string | null;
  files: FileRow[];
  overlay?: MapOverlay;
  stats?: { max_depth_m: number; wet_area_km2: number; wet_fraction: number };
  bdyRun?: ServerStepRun;
}

export default function ResultsStep({ aois, hasRunStep = true, modelStepKeys }: {
  aois: ServerAoi[];
  /** false for deck-only models (TRITON): no flood overlay, no run nagging */
  hasRunStep?: boolean;
  /** the active model's job-step keys; other models' steps are ignored so a
   *  LISFLOOD run never leaks an overlay/files into a TRITON deck view */
  modelStepKeys?: string[];
}) {
  const [results, setResults] = useState<AoiResult[]>([]);
  const [opacity, setOpacity] = useState(0.8);
  // per-AOI file selection (keys "runId:name") for "Download Selected"
  const [selected, setSelected] = useState<Record<number, Set<string>>>({});
  const [dlBusy, setDlBusy] = useState<number | null>(null);
  const [dlError, setDlError] = useState<string | null>(null);
  // stable primitive so the effect doesn't refetch on every render (the prop
  // is a fresh array literal) yet still reruns if the model's steps change
  const modelKeysSig = (modelStepKeys ?? []).join(',');

  const fileKey = (f: FileRow) => `${f.runId}:${f.name}`;
  const setFor = (aoiId: number) => selected[aoiId] ?? new Set<string>();
  const setSel = (aoiId: number, next: Set<string>) =>
    setSelected((prev) => ({ ...prev, [aoiId]: next }));
  const toggleFile = (aoiId: number, key: string) => {
    const next = new Set(setFor(aoiId));
    if (next.has(key)) next.delete(key); else next.add(key);
    setSel(aoiId, next);
  };
  const toggleAll = (aoiId: number, files: FileRow[], on: boolean) =>
    setSel(aoiId, on ? new Set(files.map(fileKey)) : new Set());

  const downloadSelected = async (aoi: ServerAoi, files: FileRow[]) => {
    const sel = setFor(aoi.id);
    const picked = files.filter((f) => sel.has(fileKey(f)));
    if (!picked.length) return;
    setDlError(null);
    setDlBusy(aoi.id);
    try {
      const blob = await downloadSelectedZip(
        aoi.id, picked.map((f) => ({ run_id: f.runId, name: f.name })));
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${aoi.name.replace(/[^\w.-]+/g, '_')}_selected.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setDlError(`${aoi.name}: ${(e as Error).message ?? 'download failed'}`);
    } finally {
      setDlBusy(null);
    }
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      // All step-run fetches go out in parallel (per AOI and across AOIs);
      // the dedupe below still walks steps in aoi.steps insertion order, so
      // "first step that produced the file" stays deterministic.
      const out: AoiResult[] = await Promise.all(aois.map(async (aoi) => {
        const res: AoiResult = { aoi, runStatus: null, files: [] };
        const allEntries = Object.entries(aoi.steps ?? {});
        const entries = modelKeysSig
          ? keepModelSteps(allEntries, modelKeysSig.split(',')) : allEntries;
        const runs = await Promise.all(
          entries.map(([, summary]) => getStepRun(summary.id).catch(() => null)));
        for (let k = 0; k < entries.length; k++) {
          const [step] = entries[k];
          const run = runs[k];
          if (!run || run.status !== 'succeeded') {
            if (step === 'run') res.runStatus = run?.status ?? null;
            continue;
          }
          if (step === 'run') res.runStatus = 'succeeded';
          if (step === 'bdy' || step === 'thyg') res.bdyRun = run;  // flow step (both models)
          for (const m of (Array.isArray(run.manifest) ? run.manifest : [])) {
            // manifests are cumulative (each step re-ships the whole deck) —
            // list every file once, under the step that first produced it
            if (!res.files.some((f) => f.name === m.name)) {
              res.files.push({ step, runId: run.id, name: m.name, bytes: m.bytes });
            }
          }
          if (step === 'run') {
            const bounds = (Array.isArray(run.manifest) ? run.manifest : [])
              .find((m) => m.name === 'overlay_bounds.json');
            const png = (Array.isArray(run.manifest) ? run.manifest : [])
              .find((m) => m.name === 'max_depth_overlay.png');
            if (bounds && png) {
              try {
                // same-origin proxy: presigned MinIO URLs fail CORS for fetch()
                const meta = await (await fetch(
                  fileProxyUrl(run.id, bounds.name))).json();
                const b = meta.bounds;
                res.overlay = {
                  id: `flood-${aoi.id}`,
                  url: fileProxyUrl(run.id, png.name),
                  coordinates: [
                    [b.west, b.north], [b.east, b.north],
                    [b.east, b.south], [b.west, b.south],
                  ],
                };
                res.stats = meta;
              } catch { /* overlay optional */ }
            }
          }
        }
        return res;
      }));
      if (alive) setResults(out);
    })();
    return () => { alive = false; };
  }, [aois, modelKeysSig]);

  const overlays = results.flatMap((r) => (r.overlay ? [r.overlay] : []));
  const anySucceeded = results.some((r) => r.runStatus === 'succeeded');

  return (
    <div className="sp-wrap">
      {hasRunStep && (anySucceeded ? (
        <div className="sp-field" style={{ maxWidth: '18rem' }}>
          <span className="sp-field-label">Flood layer opacity</span>
          <input type="range" min={0.1} max={1} step={0.05} value={opacity}
                 onChange={(e) => setOpacity(Number(e.target.value))} />
        </div>
      ) : (
        <p className="sp-muted">No completed simulations yet — finish the Run step first.</p>
      ))}

      <AoiMap
        aois={aois}
        drawing={false}
        onDrawComplete={() => undefined}
        onDrawCancel={() => undefined}
        overlays={overlays}
        overlayOpacity={opacity}
      />

      {results.map((r) => (
        <section key={r.aoi.id} className="rs-aoi">
          <div className="rs-head">
            <div>
              <span className="sp-aoi-name">{r.aoi.name}</span>
              {r.stats && (
                <span className="rs-stats">
                  max depth {r.stats.max_depth_m.toFixed(2)} m ·{' '}
                  {r.stats.wet_area_km2.toFixed(1)} km² wet ·{' '}
                  {(100 * r.stats.wet_fraction).toFixed(0)}% of area
                </span>
              )}
            </div>
          </div>

          {r.bdyRun && <HydrographChart run={r.bdyRun} />}

          {r.files.length > 0 ? (
            (() => {
              const sel = setFor(r.aoi.id);
              const allOn = r.files.every((f) => sel.has(fileKey(f)));
              const rows = r.files.map((f) => ({ key: fileKey(f), bytes: f.bytes }));
              const { count, bytes } = summarizeSelection(rows, sel);
              return (
                <div className="rs-tablewrap">
                  <table className="rs-table">
                    <thead>
                      <tr>
                        <th className="rs-check">
                          <input type="checkbox" aria-label="Select all files"
                                 checked={allOn}
                                 onChange={(e) => toggleAll(r.aoi.id, r.files, e.target.checked)} />
                        </th>
                        <th>Step</th><th>File</th><th>What it is</th><th>Size</th><th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.files.map((f) => {
                        const meta = outputMeta(f.name);
                        const key = fileKey(f);
                        return (
                          <tr key={`${f.step}-${f.name}`}
                              className={sel.has(key) ? 'rs-row-sel' : undefined}>
                            <td className="rs-check">
                              <input type="checkbox"
                                     aria-label={`Select ${f.name}`}
                                     checked={sel.has(key)}
                                     onChange={() => toggleFile(r.aoi.id, key)} />
                            </td>
                            <td className="rs-step">{STEP_LABELS[f.step] ?? f.step}</td>
                            <td className="rs-name">{f.name}</td>
                            <td className="rs-desc">
                              <strong>{meta.label}.</strong> {meta.description}
                            </td>
                            <td className="rs-size">{formatBytes(f.bytes)}</td>
                            <td>
                              <a className="rs-dl" href={fileProxyUrl(f.runId, f.name, true)}>
                                Download
                              </a>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <div className="rs-dl-bar">
                    <button type="button" className="button-secondary"
                            disabled={count === 0}
                            onClick={() => toggleAll(r.aoi.id, r.files, false)}>
                      Clear Selection
                    </button>
                    <button type="button" className="button-primary"
                            disabled={count === 0 || dlBusy === r.aoi.id}
                            onClick={() => void downloadSelected(r.aoi, r.files)}>
                      {dlBusy === r.aoi.id ? 'Zipping…'
                        : `⬇ Download Selected (${count} file${count === 1 ? '' : 's'} · ${formatBytes(bytes)})`}
                    </button>
                  </div>
                </div>
              );
            })()
          ) : (
            <p className="sp-muted">No stored outputs for this area yet.</p>
          )}
          {dlError && dlError.startsWith(`${r.aoi.name}:`) && (
            <p className="sp-error" role="alert">{dlError}</p>
          )}
        </section>
      ))}
    </div>
  );
}
