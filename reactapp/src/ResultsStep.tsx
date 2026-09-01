// reactapp/src/ResultsStep.tsx
// FE8 (first cut): the payoff screen. For each AOI whose Run succeeded,
// fetch the overlay PNG + bounds/stats the run job produced, drape it on the
// map, and list every file for download.
import { useEffect, useState } from 'react';
import AoiMap, { type MapOverlay } from './AoiMap';
import HydrographChart from './HydrographChart';
import {
  getStepRun, getStepRunOutputs, type OutputEntry, type ServerAoi,
} from './api';
import type { ServerStepRun } from './api';
import './StepPanel.css';

interface AoiResult {
  aoi: ServerAoi;
  status: string | null;
  outputs: OutputEntry[];
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
        const summary = aoi.steps?.run;
        if (!summary) {
          out.push({ aoi, status: null, outputs: [] });
          continue;
        }
        const run = await getStepRun(summary.id).catch(() => null);
        if (!run || run.status !== 'succeeded') {
          out.push({ aoi, status: run?.status ?? null, outputs: [] });
          continue;
        }
        const { outputs } = await getStepRunOutputs(run.id).catch(() => ({ outputs: [] }));
        const res: AoiResult = { aoi, status: 'succeeded', outputs };
        const bdySummary = aoi.steps?.bdy;
        if (bdySummary) {
          const bdyRun = await getStepRun(bdySummary.id).catch(() => null);
          if (bdyRun?.status === 'succeeded') res.bdyRun = bdyRun;
        }
        const png = outputs.find((o) => o.name === 'max_depth_overlay.png');
        const boundsEntry = outputs.find((o) => o.name === 'overlay_bounds.json');
        if (png?.url && boundsEntry?.url) {
          try {
            const meta = await (await fetch(boundsEntry.url)).json();
            const b = meta.bounds;
            res.overlay = {
              id: `flood-${aoi.id}`,
              url: png.url,
              coordinates: [
                [b.west, b.north], [b.east, b.north],
                [b.east, b.south], [b.west, b.south],
              ],
            };
            res.stats = meta;
          } catch { /* overlay optional */ }
        }
        out.push(res);
      }
      if (alive) setResults(out);
    })();
    return () => { alive = false; };
  }, [aois]);

  const overlays = results.flatMap((r) => (r.overlay ? [r.overlay] : []));
  const succeeded = results.filter((r) => r.status === 'succeeded');

  return (
    <div className="sp-wrap">
      {succeeded.length === 0 ? (
        <p className="sp-muted">
          No completed simulations yet — finish the Run step first.
        </p>
      ) : (
        <div className="sp-field" style={{ maxWidth: '18rem' }}>
          <span className="sp-field-label">Flood layer opacity</span>
          <input type="range" min={0.1} max={1} step={0.05} value={opacity}
                 onChange={(e) => setOpacity(Number(e.target.value))} />
        </div>
      )}

      <AoiMap
        aois={aois}
        drawing={false}
        onDrawComplete={() => undefined}
        onDrawCancel={() => undefined}
        overlays={overlays}
        overlayOpacity={opacity}
      />

      <ul className="sp-aoi-list">
        {results.map((r) => (
          <li key={r.aoi.id} className="sp-aoi">
            <div className="sp-aoi-head">
              <span className="sp-aoi-name">{r.aoi.name}</span>
              {r.stats && (
                <span className="sp-muted">
                  max depth {r.stats.max_depth_m.toFixed(2)} m ·
                  {' '}{r.stats.wet_area_km2.toFixed(1)} km² wet
                  {' '}({(100 * r.stats.wet_fraction).toFixed(0)}% of area)
                </span>
              )}
            </div>
            {r.bdyRun && <HydrographChart run={r.bdyRun} />}
            {r.status === 'succeeded' ? (
              <ul className="sp-outputs">
                {r.outputs.map((o) => (
                  <li key={o.key}>
                    {o.url ? <a href={o.url} download={o.name}>{o.name}</a> : o.name}
                  </li>
                ))}
              </ul>
            ) : (
              <span className="sp-muted">
                {r.status ? `run status: ${r.status}` : 'not simulated yet'}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
