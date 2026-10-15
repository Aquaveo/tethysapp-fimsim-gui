// reactapp/src/BoundaryPreview.tsx
// Visuals plan Phase 1 — Parvaneh's boundary check, on the web map. Shows the
// detected upstream/downstream boundary markers + main river for one AOI after
// the Boundaries step succeeds (desktop symbology: gui/bci_preview.py).
// Collapsed by default on multi-AOI projects; the map mounts on first open.
import { useEffect, useState } from 'react';
import type { FeatureCollection } from 'geojson';
import AoiMap, { GAGE_STYLE } from './AoiMap';
import type { ServerAoi, ServerStepRun } from './api';
import { fileProxyUrl } from './outputsMeta';
import './BoundaryPreview.css';

const PREVIEW_NAME = 'preview_features.geojson';

export default function BoundaryPreview({ aoi, run, defaultOpen, variant = 'boundaries' }: {
  aoi: ServerAoi;
  run: ServerStepRun;
  defaultOpen: boolean;
  /** FE63: the Flowline tool reuses the map with its own legend and copy */
  variant?: 'boundaries' | 'flowlines';
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [fc, setFc] = useState<FeatureCollection | null>(null);
  const [failed, setFailed] = useState(false);

  const available = (Array.isArray(run.manifest) ? run.manifest : [])
    .some((m) => m.name === PREVIEW_NAME);

  useEffect(() => {
    if (!open || !available || fc || failed) return;
    fetch(fileProxyUrl(run.id, PREVIEW_NAME))
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(setFc)
      .catch(() => setFailed(true));
  }, [open, available, fc, failed, run.id]);

  if (!available) {
    return (
      <p className="bp-hint">
        No {variant === 'flowlines' ? 'flowline' : 'boundary'} preview stored for this run — re-run the step to generate one.
      </p>
    );
  }

  return (
    <details className="bp" open={open}
             onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary>{variant === 'flowlines' ? 'Flowline map' : 'Boundary check map'}</summary>
      {open && (
        <div className="bp-body">
          {variant === 'flowlines' ? (
            <p className="bp-guidance">
              The thick line is the saved <strong>main river</strong> (highest
              NHD stream order); thin lines are the saved reach network;
              numbered green dots are the <strong>USGS gages</strong> inside the
              area (also in the gages CSV). The faint network underneath is the
              Area step&apos;s own lookup.
            </p>
          ) : (
            <p className="bp-guidance">
              Verify the markers: the <strong>upstream inflow</strong> should sit
              where the main river <em>enters</em> your area and the{' '}
              <strong>downstream outflow</strong> where it <em>exits</em> — both
              at the domain edge. Misplaced boundaries are the most common cause
              of an empty flood map or water pooling against an artificial wall.
              Numbered green dots are USGS gages (for the Flow Data step), not
              boundaries.
            </p>
          )}
          <AoiMap
            aois={[aoi]}
            drawing={false}
            onDrawComplete={() => undefined}
            onDrawCancel={() => undefined}
            vectorOverlays={fc ? [{ id: `bnd-${run.id}`, data: fc }] : []}
          />
          <div className="bp-legend" aria-label="Legend">
            {variant === 'flowlines' ? (
              <>
                <span><i className="bp-line" /> Main river</span>
                <span><i className="bp-line bp-thin" /> Saved flowlines</span>
                <span>
                  <i className="bp-dot"
                     style={{ background: GAGE_STYLE.fill, border: `2.5px solid ${GAGE_STYLE.stroke}` }} />
                  {' '}USGS gage (numbered)
                </span>
              </>
            ) : (
              <>
                <span><i className="bp-line" /> Main river</span>
                <span><i className="bp-dot bp-up" /> Upstream (inflow)</span>
                <span><i className="bp-dot bp-down" /> Downstream (outflow)</span>
                <span>
                  <i className="bp-dot"
                     style={{ background: GAGE_STYLE.fill, border: `2.5px solid ${GAGE_STYLE.stroke}` }} />
                  {' '}USGS gage (numbered)
                </span>
              </>
            )}
          </div>
          {failed && <p className="bp-hint">The preview could not be loaded.</p>}
        </div>
      )}
    </details>
  );
}
