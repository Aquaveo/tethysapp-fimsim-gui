// reactapp/src/StepOverview.tsx
// FIMSIM-FE17: per-step context, desktop parity — Parvaneh's desktop shows
// users what each step is about to consume (AOI facts, detected river,
// upstream choices) so mistakes surface where they happen. Data comes from
// the AOI row + each step summary's submitted config (no extra fetches).
import type { ServerAoi } from './api';
import './StepOverview.css';

/** One short human line per completed upstream step, from its config. */
export function summarizeStep(step: string, cfg: Record<string, unknown>): string {
  const s = (k: string) => (cfg[k] === undefined || cfg[k] === null ? '' : String(cfg[k]));
  switch (step) {
    case 'dem':
    case 'tdem':
      return `${s('dem_source') === 'hand' ? 'HAND' : '3DEP'} @ ${s('dem_res_m') || '30'} m`;
    case 'manning':
    case 'tfric':
      return s('fric_mode') === 'fixed'
        ? `fixed n = ${s('fpfric_val') || '?'}`
        : `${(s('lulc_download_source') || s('lulc_source') || 'esri').includes('nlcd') ? 'NLCD' : 'Esri'} land cover`;
    case 'bci':
      return `${s('upstream_mode') === 'fixed_discharge'
        ? `fixed inflow ${s('fixed_discharge_cms')} m³/s` : 'time-varying inflow'} · ${
        s('downstream_type') === 'HFIX' ? `fixed level ${s('downstream_hfix')} m` : 'free outflow'}`;
    case 'tbc': {
      const t = s('bc_type');
      const label = t === '0' ? 'free flow' : t === '1' ? 'level vs time'
        : t === '3' ? `Froude ${s('value')}` : `normal slope ${s('value') || '0.001'}`;
      return `downstream: ${label}`;
    }
    case 'bdy':
    case 'thyg': {
      const src = s('bdy_source') === 'usgs' ? `USGS ${s('gage_id')}`
        : s('bdy_source') === 'nwm_forecast' ? 'NWM forecast' : 'NWM retrospective';
      const win = s('start_dt') && s('end_dt')
        ? ` · ${s('start_dt').slice(0, 10)} → ${s('end_dt').slice(0, 10)}` : '';
      return src + win;
    }
    case 'par':
      return `${s('solver_mode') || 'acceleration'} solver`
        + (s('sim_time') ? ` · ${s('sim_time')} s` : ' · length from hydrograph');
    case 'tcfg':
      return `Δt ${s('time_step') || '10'} s · output every ${s('print_interval') || '3600'} s`;
    case 'run':
      return `time limit ${s('solver_timeout_s') || '3600'} s`;
    default:
      return '';
  }
}

const STATUS_GLYPH: Record<string, string> = {
  succeeded: '✓', failed: '✗', cancelled: '✗',
  running: '…', queued: '…', pending: '…', uploading: '…',
};

interface Props {
  aoi: ServerAoi;
  /** the wizard's job steps for the ACTIVE model, in order */
  stepOrder: { id: string; label: string }[];
  /** the step whose panel is open (its own row is omitted) */
  currentStep: string;
}

/** A compact context strip for one AOI: the facts every step consumes, plus
 *  one line per upstream step that has run. */
export default function StepOverview({ aoi, stepOrder, currentStep }: Props) {
  const facts = [
    `${aoi.area_km2 < 10 ? aoi.area_km2.toFixed(1) : Math.round(aoi.area_km2)} km²`,
    aoi.working_crs_epsg ? `EPSG:${aoi.working_crs_epsg}` : null,
    aoi.states?.length ? aoi.states.map((st) => st.abbr ?? st.name).join(', ') : null,
    aoi.river_name ? `main river: ${aoi.river_name}` : null,
    aoi.lookup?.gages?.length ? `${aoi.lookup.gages.length} gage(s)` : null,
  ].filter(Boolean);

  const upstream = stepOrder
    .filter((st) => st.id !== currentStep)
    .map((st) => ({ ...st, summary: aoi.steps?.[st.id] }))
    .filter((st) => st.summary)
    .map((st) => ({
      label: st.label,
      glyph: STATUS_GLYPH[st.summary!.status] ?? '·',
      ok: st.summary!.status === 'succeeded',
      text: summarizeStep(st.id, (st.summary as { config?: Record<string, unknown> }).config ?? {}),
    }));

  return (
    <div className="so-strip">
      <span className="so-facts">{facts.join(' · ')}</span>
      {upstream.map((u) => (
        <span key={u.label} className={'so-chip' + (u.ok ? ' ok' : '')}>
          <span className="so-glyph" aria-hidden="true">{u.glyph}</span>
          {u.label}{u.text ? `: ${u.text}` : ''}
        </span>
      ))}
    </div>
  );
}
