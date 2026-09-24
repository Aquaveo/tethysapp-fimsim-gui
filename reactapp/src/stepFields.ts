// reactapp/src/stepFields.ts
// Per-step form fields for the generic StepPanel. Keys are exactly the
// fimcore kwargs (BE7's config contract); labels are user-language.
export interface Condition { key: string; value: unknown }

export interface FieldSpec {
  key: string;
  label: string;
  widget: 'select' | 'number' | 'text' | 'datetime' | 'date';
  options?: { value: string | number; label: string }[];
  help?: string;
  /** only show when another field has this value; an array means ALL must hold */
  showIf?: Condition | Condition[];
  required?: boolean;
  /** for a 'date' field: submit as end-of-day (23:59) rather than 00:00 */
  endOfDay?: boolean;
}

/**
 * Expand date-only event fields to a full datetime at submit: the start date
 * to 00:00 and the end date to 23:59, so a chosen day is fully included. Bare
 * "YYYY-MM-DD" only — an already-timed value or a non-date field is left as-is.
 */
export function expandEventDates(
  config: Record<string, unknown>, fields: Pick<FieldSpec, 'key' | 'widget' | 'endOfDay'>[],
): Record<string, unknown> {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const out: Record<string, unknown> = { ...config };
  for (const k of Object.keys(out)) {
    const f = byKey.get(k);
    if (f?.widget === 'date' && typeof out[k] === 'string'
        && /^\d{4}-\d{2}-\d{2}$/.test(out[k] as string)) {
      out[k] = `${out[k]}${f.endOfDay ? 'T23:59' : 'T00:00'}`;
    }
  }
  return out;
}

/** Whether a field's showIf is satisfied. `get(key)` returns the live value. */
export function fieldVisible(
  showIf: FieldSpec['showIf'], get: (key: string) => unknown,
): boolean {
  if (!showIf) return true;
  const conds = Array.isArray(showIf) ? showIf : [showIf];
  return conds.every((c) => get(c.key) === c.value);
}

/** Land-cover years each source publishes (Parvaneh, 2026-09-23). */
export const SENTINEL2_YEAR_OPTIONS =
  [2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017]
    .map((y) => ({ value: y, label: String(y) }));
export const NLCD_YEAR_OPTIONS =
  ['2021', '2019', '2016', '2013', '2011', '2008', '2006', '2004', '2001']
    .map((y) => ({ value: y, label: y }));

/**
 * Coerce number-widget values to real numbers at SUBMIT time only.
 * The inputs keep the user's raw string while typing (so "0.0001" isn't
 * collapsed to 0 by a mid-keystroke Number("0.")); this runs once on submit.
 * Empty strings become null so the caller drops them.
 */
export function coerceConfigNumbers(
  config: Record<string, unknown>,
  fields: Pick<FieldSpec, 'key' | 'widget'>[],
): Record<string, unknown> {
  const numberKeys = new Set(
    fields.filter((f) => f.widget === 'number').map((f) => f.key));
  const out: Record<string, unknown> = { ...config };
  for (const k of Object.keys(out)) {
    if (!numberKeys.has(k) || typeof out[k] !== 'string') continue;
    const s = (out[k] as string).trim();
    if (s === '') { out[k] = null; continue; }
    const n = Number(s);
    out[k] = Number.isFinite(n) ? n : out[k]; // leave bad input for the server
  }
  return out;
}

export const STEP_FIELDS: Record<string, FieldSpec[]> = {
  dem: [
    {
      key: 'dem_source', label: 'Elevation source', widget: 'select',
      options: [
        { value: '3dep', label: 'USGS 3DEP (elevation)' },
        { value: 'hand', label: 'TACC HAND (height above drainage)' },
      ],
    },
    {
      key: 'dem_res_m', label: 'Resolution', widget: 'select',
      options: [
        { value: 1, label: '1 m (largest downloads, slowest runs)' },
        { value: 3, label: '3 m' },
        { value: 10, label: '10 m — recommended baseline' },
        { value: 30, label: '30 m (fast preview)' },
        { value: 90, label: '90 m (fastest, coarse)' },
      ],
      help: 'Source: USGS 3DEP 1/3 arc-second DEM (~10 m) — other resolutions are '
        + 'resampled from it. Finer grids increase simulation time substantially.',
    },
  ],
  manning: [
    {
      key: 'fric_mode', label: 'Friction', widget: 'select',
      options: [
        { value: 'varying', label: 'From land cover (varying)' },
        { value: 'fixed', label: 'Single value everywhere (fixed)' },
      ],
    },
    {
      key: 'fpfric_val', label: "Fixed Manning's n", widget: 'number',
      showIf: { key: 'fric_mode', value: 'fixed' },
    },
    {
      key: 'lulc_download_source', label: 'Land cover source', widget: 'select',
      showIf: { key: 'fric_mode', value: 'varying' },
      options: [
        { value: 'esri', label: 'Esri Sentinel-2 (10 m, global)' },
        { value: 'nlcd', label: 'NLCD (30 m, USA)' },
      ],
    },
    {
      key: 'lulc_year', label: 'Land cover year', widget: 'select',
      options: SENTINEL2_YEAR_OPTIONS,
      showIf: [{ key: 'fric_mode', value: 'varying' },
               { key: 'lulc_download_source', value: 'esri' }],
    },
    {
      key: 'nlcd_year', label: 'Land cover year', widget: 'select',
      options: NLCD_YEAR_OPTIONS,
      showIf: [{ key: 'fric_mode', value: 'varying' },
               { key: 'lulc_download_source', value: 'nlcd' }],
    },
  ],
  bci: [
    {
      key: 'upstream_mode', label: 'Upstream inflow', widget: 'select',
      options: [
        { value: 'varying_discharge', label: 'Time-varying discharge (from the Flow step)' },
        { value: 'fixed_discharge', label: 'Fixed discharge' },
      ],
    },
    {
      key: 'fixed_discharge_cms', label: 'Fixed discharge (m³/s)', widget: 'number',
      showIf: { key: 'upstream_mode', value: 'fixed_discharge' },
    },
    {
      key: 'downstream_type', label: 'Downstream boundary', widget: 'select',
      options: [
        { value: 'FREE', label: 'Free outflow (normal depth)' },
        { value: 'HFIX', label: 'Fixed water level' },
      ],
    },
    {
      key: 'downstream_slope', label: 'Bed slope at outflow', widget: 'number',
      showIf: { key: 'downstream_type', value: 'FREE' },
      help: 'Used for the normal-depth outflow calculation; 0.0001 suits most lowland rivers.',
    },
    {
      key: 'downstream_hfix', label: 'Fixed level (m)', widget: 'number',
      showIf: { key: 'downstream_type', value: 'HFIX' },
    },
  ],
  bdy: [
    {
      key: 'bdy_source', label: 'Flow data source', widget: 'select',
      options: [
        { value: 'nwm_retro', label: 'NWM retrospective (1979–2023)' },
        { value: 'nwm_forecast', label: 'NWM forecast' },
        { value: 'usgs', label: 'USGS gage' },
      ],
    },
    { key: 'start_dt', label: 'Event start (date)', widget: 'date', required: true },
    { key: 'end_dt', label: 'Event end (date)', widget: 'date', required: true, endOfDay: true },
    { key: 'interval_hours', label: 'Interval (hours)', widget: 'number' },
    {
      key: 'gage_id', label: 'USGS gage ID', widget: 'text',
      showIf: { key: 'bdy_source', value: 'usgs' },
      help: 'Detected gages are listed on the AOI cards.',
    },
  ],
  par: [
    {
      key: 'solver_mode', label: 'Solver', widget: 'select',
      options: [
        { value: 'acceleration', label: 'Acceleration (recommended)' },
        { value: 'adaptive_default', label: 'Adaptive timestep' },
        { value: 'diffusion', label: 'Diffusion' },
      ],
    },
    { key: 'sim_time', label: 'Simulation time (s)', widget: 'number',
      help: 'Leave blank to use the flow data’s full window.' },
    { key: 'initial_tstep', label: 'Initial timestep (s)', widget: 'number' },
    { key: 'saveint', label: 'Output interval (s)', widget: 'number' },
  ],
  // ── TRITON (deck generation — parity with the desktop tabs) ──
  tdem: [
    {
      key: 'dem_res_m', label: 'Resolution', widget: 'select',
      options: [
        { value: 1, label: '1 m (largest grids, slowest runs)' },
        { value: 3, label: '3 m' },
        { value: 10, label: '10 m — recommended baseline' },
        { value: 30, label: '30 m (fast preview)' },
        { value: 90, label: '90 m (fastest, coarse)' },
      ],
      help: 'Source: USGS 3DEP 1/3 arc-second DEM (~10 m) — other resolutions are resampled from it.',
    },
  ],
  tfric: [
    {
      key: 'fric_mode', label: 'Friction', widget: 'select',
      options: [
        { value: 'varying', label: 'From land cover (varying)' },
        { value: 'fixed', label: 'Single value everywhere (fixed)' },
      ],
    },
    {
      key: 'fpfric_val', label: "Fixed Manning's n", widget: 'number',
      showIf: { key: 'fric_mode', value: 'fixed' },
    },
    {
      key: 'lulc_source', label: 'Land cover source', widget: 'select',
      showIf: { key: 'fric_mode', value: 'varying' },
      options: [
        { value: 'download', label: 'Esri Sentinel-2 (10 m, global)' },
        { value: 'download_nlcd', label: 'NLCD (30 m, USA)' },
      ],
    },
    {
      key: 'lulc_year', label: 'Land cover year', widget: 'select',
      options: SENTINEL2_YEAR_OPTIONS,
      showIf: [{ key: 'fric_mode', value: 'varying' },
               { key: 'lulc_source', value: 'download' }],
    },
    {
      key: 'nlcd_year', label: 'Land cover year', widget: 'select',
      options: NLCD_YEAR_OPTIONS,
      showIf: [{ key: 'fric_mode', value: 'varying' },
               { key: 'lulc_source', value: 'download_nlcd' }],
    },
    // No resolution control: the friction grid is snapped to the terrain DEM
    // on the server, so a second resolution here would only mislead.
  ],
  tbc: [
    {
      key: 'bc_type', label: 'Downstream boundary', widget: 'select',
      options: [
        { value: 2, label: 'Normal slope (recommended)' },
        { value: 0, label: 'Free flow / supercritical' },
        { value: 3, label: 'Froude number' },
      ],
      help: 'The inflow source point is detected automatically where the main river enters the area.',
    },
    {
      key: 'value', label: 'Boundary value', widget: 'number',
      help: 'Slope for the normal-slope type (default 0.001); Froude number for the Froude type; ignored for free flow.',
    },
  ],
  thyg: [
    {
      key: 'bdy_source', label: 'Flow data source', widget: 'select',
      options: [
        { value: 'nwm_retro', label: 'NWM retrospective (1979–2023)' },
        { value: 'nwm_forecast', label: 'NWM forecast' },
        { value: 'usgs', label: 'USGS gage' },
      ],
    },
    { key: 'start_dt', label: 'Event start (date)', widget: 'date', required: true },
    { key: 'end_dt', label: 'Event end (date)', widget: 'date', required: true, endOfDay: true },
    { key: 'interval_hours', label: 'Interval (hours)', widget: 'number' },
    {
      key: 'gage_id', label: 'USGS gage ID', widget: 'text',
      showIf: { key: 'bdy_source', value: 'usgs' },
      help: 'Detected gages are listed on the AOI cards.',
    },
  ],
  tcfg: [
    { key: 'time_step', label: 'Timestep (s)', widget: 'number' },
    { key: 'print_interval', label: 'Output interval (s)', widget: 'number' },
    {
      key: 'output_format', label: 'Output format', widget: 'select',
      options: [
        { value: 'ASC', label: 'ASCII grids' },
        { value: 'GTIFF', label: 'GeoTIFF' },
        { value: 'BIN', label: 'Binary' },
      ],
    },
    {
      key: 'print_option', label: 'Outputs', widget: 'select',
      options: [
        { value: 'huv', label: 'Depth + velocities (huv)' },
        { value: 'h', label: 'Depth only (h)' },
      ],
    },
    { key: 'courant', label: 'Courant number', widget: 'number',
      help: '0.05–1.0; lower is more stable, slower.' },
  ],
  run: [
    { key: 'solver_timeout_s', label: 'Time limit (s)', widget: 'number',
      help: 'The run is stopped if it exceeds this.' },
    {
      key: 'keep_snapshots', label: 'Depth time series', widget: 'select',
      options: [
        { value: 'false', label: 'Max-depth map only (default)' },
        { value: 'true', label: 'Also keep every depth snapshot (zip)' },
      ],
      help: 'Snapshots are one grid per output interval — for animations; adds a large zip.',
    },
  ],
};
