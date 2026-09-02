// reactapp/src/WelcomeModal.tsx
// FIMSIM-FE15: first-visit expectation-setting, FIMBench's welcome-modal
// format. Limits come from the server (api/limits) so this copy can't drift
// from what BE10 enforces.
import { useEffect, useState } from 'react';
import './WelcomeModal.css';

interface Limits {
  max_aoi_area_km2: number;
  dem_baseline_res_m: number;
}

type Props = { onClose: (dontShowAgain: boolean) => void };

export default function WelcomeModal({ onClose }: Props) {
  const [dontShow, setDontShow] = useState(false);
  const [limits, setLimits] = useState<Limits | null>(null);

  useEffect(() => {
    fetch('/apps/fimsim-gui/api/limits/')
      .then((r) => r.json()).then(setLimits).catch(() => undefined);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose(dontShow);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dontShow]);

  const cap = limits ? `${Math.round(limits.max_aoi_area_km2).toLocaleString()} km²` : '…';
  const baseline = limits ? `${limits.dem_baseline_res_m} m` : '10 m';

  return (
    <div className="wm-backdrop" onClick={() => onClose(dontShow)}
         role="dialog" aria-modal="true" aria-label="Welcome to FIMsim">
      <div className="wm-card" onClick={(e) => e.stopPropagation()}>
        <div className="wm-head">
          <div>
            <h2 className="wm-title">Welcome to FIMsim</h2>
            <p className="wm-tagline">
              Set up and run 2D flood simulations from your browser — no
              installation, no GIS expertise required.
            </p>
          </div>
          <button className="wm-close" onClick={() => onClose(dontShow)} aria-label="Close">✕</button>
        </div>

        <div className="wm-body">
          <p>
            Define a study area and FIMsim downloads every input a LISFLOOD-FP
            flood simulation needs — terrain, land cover, river network,
            streamflow — runs the model, and maps the flood.
          </p>
          <ul className="wm-list">
            <li>
              <strong>Study areas are capped at {cap}.</strong> Larger areas
              cost too much compute for a shared portal — for large-scale case
              studies, use the{' '}
              <a href="https://github.com/pnikrou/FIMsim" target="_blank" rel="noreferrer">
                desktop FIMsim
              </a>.
            </li>
            <li>
              <strong>{baseline} elevation is the baseline product.</strong>{' '}
              Finer resolutions (1 m / 3 m) are available but increase
              simulation times substantially.
            </li>
            <li>
              <strong>Areas must be rectangular</strong> (a LISFLOOD-FP/TRITON
              mesh requirement) — draw any shape and it closes into its
              enclosing rectangle automatically.
            </li>
            <li>
              <strong>Your work is saved per project</strong> — reopen it any
              time from the Simulations list.
            </li>
          </ul>
          <div className="wm-docs">
            For the full guide, use the{' '}
            <span className="wm-doc-pill">Documentation</span> link in the
            header bar above.
          </div>
          <div className="wm-actions">
            <label className="wm-dontshow">
              <input type="checkbox" checked={dontShow}
                     onChange={(e) => setDontShow(e.target.checked)} />
              Don&apos;t show on startup
            </label>
            <button type="button" className="button-primary"
                    onClick={() => onClose(dontShow)}>
              Got it
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
