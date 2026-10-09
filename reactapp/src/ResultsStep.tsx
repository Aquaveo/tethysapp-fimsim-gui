// reactapp/src/ResultsStep.tsx
// FE8: the payoff screen. Two tabs (FIMSIM-FE59):
//   "Results"    — the flood overlay on the map (served same-origin — MinIO
//                  presigned URLs are CORS-blocked for fetch/MapLibre), the
//                  run statistics and the run step's files; or, with no
//                  successful run, a prominent notice (FE56). For a deck-only
//                  model (TRITON) it is the deck download + "runs off-portal".
//   "Input Data" — the hydrograph recap and every input step's files with
//                  the FE30 select / Download Selected zip.
import { useEffect, useState } from 'react';
import AoiMap, { type MapOverlay } from './AoiMap';
import HydrographChart from './HydrographChart';
import { downloadSelectedZip, getStepRun, type ServerAoi, type ServerStepRun } from './api';
import {
  fileProxyUrl, formatBytes, keepModelSteps, outputMeta, saveBlob, splitResultFiles,
  summarizeSelection, zipFilename, zipSelection,
} from './outputsMeta';
import './StepPanel.css';
import './ResultsStep.css';

const STEP_LABELS: Record<string, string> = {
  dem: 'Terrain', manning: 'Roughness', bci: 'Boundaries',
  bdy: 'Flow Data', par: 'Settings', run: 'Simulation',
  tdem: 'Terrain', tfric: 'Friction', tbc: 'Boundaries',
  thyg: 'Hydrograph', tcfg: 'Config',
};

type Tab = 'results' | 'inputs';

const TABS: { id: Tab; label: string }[] = [
  { id: 'inputs', label: 'Input Data' },
  { id: 'results', label: 'Results' },
];

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

const fileKey = (f: FileRow) => `${f.runId}:${f.name}`;

/** One AOI's file table with per-file links + select / Download Selected. */
function FilesTable({ aoi, files, selected, onSelect, zipSuffix }: {
  aoi: ServerAoi;
  files: FileRow[];
  selected: Set<string>;
  onSelect: (next: Set<string>) => void;
  zipSuffix: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleFile = (key: string) => {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key); else next.add(key);
    onSelect(next);
  };
  // only this table's rows change — the other tab's picks for the same AOI stay
  const toggleAll = (on: boolean) => {
    const next = new Set(selected);
    for (const f of files) {
      if (on) next.add(fileKey(f)); else next.delete(fileKey(f));
    }
    onSelect(next);
  };

  const downloadSelected = async () => {
    const picked = files.filter((f) => selected.has(fileKey(f)));
    if (!picked.length) return;
    setError(null);
    setBusy(true);
    try {
      const blob = await downloadSelectedZip(aoi.id, zipSelection(picked));
      saveBlob(blob, zipFilename(aoi.name, zipSuffix));
    } catch (e) {
      setError((e as Error).message ?? 'download failed');
    } finally {
      setBusy(false);
    }
  };

  const allOn = files.length > 0 && files.every((f) => selected.has(fileKey(f)));
  const { count, bytes } = summarizeSelection(
    files.map((f) => ({ key: fileKey(f), bytes: f.bytes })), selected);

  return (
    <div className="rs-tablewrap">
      <table className="rs-table">
        <thead>
          <tr>
            <th className="rs-check">
              <input type="checkbox" aria-label="Select all files"
                     checked={allOn}
                     onChange={(e) => toggleAll(e.target.checked)} />
            </th>
            <th>Step</th><th>File</th><th>What it is</th><th>Size</th><th></th>
          </tr>
        </thead>
        <tbody>
          {files.map((f) => {
            const meta = outputMeta(f.name);
            const key = fileKey(f);
            return (
              <tr key={`${f.step}-${f.name}`}
                  className={selected.has(key) ? 'rs-row-sel' : undefined}>
                <td className="rs-check">
                  <input type="checkbox"
                         aria-label={`Select ${f.name}`}
                         checked={selected.has(key)}
                         onChange={() => toggleFile(key)} />
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
                onClick={() => toggleAll(false)}>
          Clear Selection
        </button>
        <button type="button" className="button-primary"
                disabled={count === 0 || busy}
                onClick={() => void downloadSelected()}>
          {busy ? 'Zipping…'
            : `⬇ Download Selected (${count} file${count === 1 ? '' : 's'} · ${formatBytes(bytes)})`}
        </button>
      </div>
      {error && <p className="sp-error" role="alert">{aoi.name}: {error}</p>}
    </div>
  );
}

/** TRITON: the whole deck for one AOI as a single zip (the model runs off-portal). */
function DeckDownload({ aoi, files }: { aoi: ServerAoi; files: FileRow[] }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const total = files.reduce((n, f) => n + f.bytes, 0);
  const download = async () => {
    setError(null);
    setBusy(true);
    try {
      const blob = await downloadSelectedZip(aoi.id, zipSelection(files));
      saveBlob(blob, zipFilename(aoi.name, 'triton_deck'));
    } catch (e) {
      setError((e as Error).message ?? 'download failed');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="rs-deck">
      <button type="button" className="button-primary" disabled={busy || !files.length}
              onClick={() => void download()}>
        {busy ? 'Zipping…'
          : `⬇ Download TRITON deck (${files.length} file${files.length === 1 ? '' : 's'} · ${formatBytes(total)})`}
      </button>
      <span className="sp-muted">
        Each file is also listed individually under Input Data.
      </span>
      {error && <p className="sp-error" role="alert">{aoi.name}: {error}</p>}
    </div>
  );
}

export default function ResultsStep({
  aois, hasRunStep = true, modelStepKeys, onGoToRun,
}: {
  aois: ServerAoi[];
  /** false for deck-only models (TRITON): no flood overlay, no run nagging */
  hasRunStep?: boolean;
  /** the active model's job-step keys; other models' steps are ignored so a
   *  LISFLOOD run never leaks an overlay/files into a TRITON deck view */
  modelStepKeys?: string[];
  /** jump back to the Run step (the no-run notice's call to action) */
  onGoToRun?: () => void;
}) {
  const [results, setResults] = useState<AoiResult[]>([]);
  const [tab, setTab] = useState<Tab>('results');
  const [opacity, setOpacity] = useState(0.8);
  // per-AOI file selection (keys "runId:name") for "Download Selected"; shared
  // across both tabs, each table only acts on its own rows
  const [selected, setSelected] = useState<Record<number, Set<string>>>({});
  // stable primitive so the effect doesn't refetch on every render (the prop
  // is a fresh array literal) yet still reruns if the model's steps change
  const modelKeysSig = (modelStepKeys ?? []).join(',');

  const setFor = (aoiId: number) => selected[aoiId] ?? new Set<string>();
  const setSel = (aoiId: number, next: Set<string>) =>
    setSelected((prev) => ({ ...prev, [aoiId]: next }));

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
                // true 4-corner quad when present (FIMSIM-FE33), else the
                // W/S/E/N envelope for older runs
                const coordinates = (Array.isArray(meta.corners) && meta.corners.length === 4)
                  ? meta.corners as MapOverlay['coordinates']
                  : [
                      [b.west, b.north], [b.east, b.north],
                      [b.east, b.south], [b.west, b.south],
                    ] as MapOverlay['coordinates'];
                res.overlay = {
                  id: `flood-${aoi.id}`,
                  url: fileProxyUrl(run.id, png.name),
                  coordinates,
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

  const onTabKey = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const i = TABS.findIndex((t) => t.id === tab);
    const next = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length];
    setTab(next.id);
    (e.currentTarget.parentElement?.querySelector(
      `[data-tab="${next.id}"]`) as HTMLButtonElement | null)?.focus();
  };

  return (
    <div className="sp-wrap">
      <div className="rs-tabs" role="tablist" aria-label="Results sections">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" data-tab={t.id}
                  id={`rs-tab-${t.id}`} aria-controls={`rs-panel-${t.id}`}
                  aria-selected={tab === t.id} tabIndex={tab === t.id ? 0 : -1}
                  className={'rs-tab' + (tab === t.id ? ' is-active' : '')}
                  onClick={() => setTab(t.id)} onKeyDown={onTabKey}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'results' && (
        <div role="tabpanel" id="rs-panel-results" aria-labelledby="rs-tab-results"
             className="rs-panel">
          {hasRunStep && (anySucceeded ? (
            <div className="sp-field" style={{ maxWidth: '18rem' }}>
              <span className="sp-field-label">Flood layer opacity</span>
              <input type="range" min={0.1} max={1} step={0.05} value={opacity}
                     onChange={(e) => setOpacity(Number(e.target.value))} />
            </div>
          ) : (
            <div className="rs-norun" role="status">
              <strong>No simulation has been run.</strong>{' '}
              The model was not run for this project, so there are no flood results
              to show — only the input files you built, listed under Input Data.
              {onGoToRun && (
                <>
                  {' '}
                  <button type="button" className="rs-norun-link" onClick={onGoToRun}>
                    Go to the Run step
                  </button>
                </>
              )}
            </div>
          ))}
          {!hasRunStep && (
            <p className="rs-offportal">
              TRITON runs off-portal: download the input deck below and run it on
              your own GPU/HPC system. The portal does not produce TRITON flood maps.
            </p>
          )}

          <AoiMap
            aois={aois}
            drawing={false}
            onDrawComplete={() => undefined}
            onDrawCancel={() => undefined}
            overlays={overlays}
            overlayOpacity={opacity}
          />

          {results.map((r) => {
            const { results: runFiles } = splitResultFiles(r.files);
            return (
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
                {!hasRunStep ? (
                  r.files.length > 0
                    ? <DeckDownload aoi={r.aoi} files={r.files} />
                    : <p className="sp-muted">No deck files for this area yet.</p>
                ) : runFiles.length > 0 ? (
                  <FilesTable aoi={r.aoi} files={runFiles} zipSuffix="results"
                              selected={setFor(r.aoi.id)}
                              onSelect={(next) => setSel(r.aoi.id, next)} />
                ) : (
                  <p className="sp-muted">No simulation outputs for this area.</p>
                )}
              </section>
            );
          })}
        </div>
      )}

      {tab === 'inputs' && (
        <div role="tabpanel" id="rs-panel-inputs" aria-labelledby="rs-tab-inputs"
             className="rs-panel">
          {results.map((r) => {
            const { inputs } = splitResultFiles(r.files);
            return (
              <section key={r.aoi.id} className="rs-aoi">
                <div className="rs-head">
                  <span className="sp-aoi-name">{r.aoi.name}</span>
                </div>
                {r.bdyRun && <HydrographChart run={r.bdyRun} />}
                {inputs.length > 0 ? (
                  <FilesTable aoi={r.aoi} files={inputs} zipSuffix="inputs"
                              selected={setFor(r.aoi.id)}
                              onSelect={(next) => setSel(r.aoi.id, next)} />
                ) : (
                  <p className="sp-muted">No stored input files for this area yet.</p>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
