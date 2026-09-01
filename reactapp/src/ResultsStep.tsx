// reactapp/src/ResultsStep.tsx
// FE8: the payoff screen. Flood overlay on the map (served same-origin —
// MinIO presigned URLs are CORS-blocked for fetch/MapLibre), the hydrograph
// recap, and a full outputs table across EVERY step with descriptions and a
// per-area Download All zip.
import { useEffect, useState } from 'react';
import AoiMap, { type MapOverlay } from './AoiMap';
import HydrographChart from './HydrographChart';
import { getStepRun, type ServerAoi, type ServerStepRun } from './api';
import { aoiZipUrl, fileProxyUrl, outputMeta } from './outputsMeta';
import './StepPanel.css';
import './ResultsStep.css';

const STEP_LABELS: Record<string, string> = {
  dem: 'Terrain', manning: 'Roughness', bci: 'Boundaries',
  bdy: 'Flow Data', par: 'Settings', run: 'Simulation',
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

export default function ResultsStep({ aois }: { aois: ServerAoi[] }) {
  const [results, setResults] = useState<AoiResult[]>([]);
  const [opacity, setOpacity] = useState(0.8);

  useEffect(() => {
    let alive = true;
    (async () => {
      const out: AoiResult[] = [];
      for (const aoi of aois) {
        const res: AoiResult = { aoi, runStatus: null, files: [] };
        for (const [step, summary] of Object.entries(aoi.steps ?? {})) {
          const run = await getStepRun(summary.id).catch(() => null);
          if (!run || run.status !== 'succeeded') {
            if (step === 'run') res.runStatus = run?.status ?? null;
            continue;
          }
          if (step === 'run') res.runStatus = 'succeeded';
          if (step === 'bdy') res.bdyRun = run;
          for (const m of (Array.isArray(run.manifest) ? run.manifest : [])) {
            res.files.push({ step, runId: run.id, name: m.name, bytes: m.bytes });
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
        out.push(res);
      }
      if (alive) setResults(out);
    })();
    return () => { alive = false; };
  }, [aois]);

  const overlays = results.flatMap((r) => (r.overlay ? [r.overlay] : []));
  const anySucceeded = results.some((r) => r.runStatus === 'succeeded');

  return (
    <div className="sp-wrap">
      {anySucceeded ? (
        <div className="sp-field" style={{ maxWidth: '18rem' }}>
          <span className="sp-field-label">Flood layer opacity</span>
          <input type="range" min={0.1} max={1} step={0.05} value={opacity}
                 onChange={(e) => setOpacity(Number(e.target.value))} />
        </div>
      ) : (
        <p className="sp-muted">No completed simulations yet — finish the Run step first.</p>
      )}

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
            {r.files.length > 0 && (
              <a className="button-primary rs-zip" href={aoiZipUrl(r.aoi.id)}>
                ⬇ Download all ({r.files.length} files)
              </a>
            )}
          </div>

          {r.bdyRun && <HydrographChart run={r.bdyRun} />}

          {r.files.length > 0 ? (
            <div className="rs-tablewrap">
              <table className="rs-table">
                <thead>
                  <tr><th>Step</th><th>File</th><th>What it is</th><th>Size</th><th></th></tr>
                </thead>
                <tbody>
                  {r.files.map((f) => {
                    const meta = outputMeta(f.name);
                    return (
                      <tr key={`${f.step}-${f.name}`}>
                        <td className="rs-step">{STEP_LABELS[f.step] ?? f.step}</td>
                        <td className="rs-name">{f.name}</td>
                        <td className="rs-desc">
                          <strong>{meta.label}.</strong> {meta.description}
                        </td>
                        <td className="rs-size">
                          {f.bytes >= 1e6 ? `${(f.bytes / 1e6).toFixed(1)} MB`
                            : `${Math.max(1, Math.round(f.bytes / 1024))} kB`}
                        </td>
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
            </div>
          ) : (
            <p className="sp-muted">No stored outputs for this area yet.</p>
          )}
        </section>
      ))}
    </div>
  );
}
