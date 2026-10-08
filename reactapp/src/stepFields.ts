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
  /** number widget: HTML min/max/step + a submit-time range check */
  min?: number;
  max?: number;
  step?: number;
  /**
   * When field `key` changes to a value listed in `values`, this field is
   * reset to the matching entry — for inputs whose meaning depends on a
   * sibling select (TRITON's boundary value: slope vs Froude number).
   */
  linkedDefault?: { key: string; values: Record<string, unknown> };
}

/**
 * Apply linked defaults after `changedKey` was set to `newValue`: every field
 * whose linkedDefault points at `changedKey` takes the default for the new
 * value (if one is listed). Returns a new config; unrelated keys untouched.
 */
export function applyLinkedDefaults(
  config: Record<string, unknown>, fields: Pick<FieldSpec, 'key' | 'linkedDefault'>[],
  changedKey: string, newValue: unknown,
): Record<string, unknown> {
  const out = { ...config };
  for (const f of fields) {
    const ld = f.linkedDefault;
    if (!ld || ld.key !== changedKey) continue;
    const k = String(newValue);
    if (k in ld.values) out[f.key] = ld.values[k];
  }
  return out;
}

/**
 * Submit-time range check for number fields carrying min/max. Blank values
 * are not a range problem (required-ness is checked separately). Returns one
 * human message per violation.
 */
export function rangeProblems(
  config: Record<string, unknown>,
  fields: Pick<FieldSpec, 'key' | 'label' | 'widget' | 'min' | 'max'>[],
): string[] {
  const problems: string[] = [];
  for (const f of fields) {
    if (f.widget !== 'number' || (f.min === undefined && f.max === undefined)) continue;
    const raw = config[f.key];
    if (raw === null || raw === undefined || raw === '') continue;
    const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
    if (!Number.isFinite(n)) continue; // left for the server's own validation
    if ((f.min !== undefined && n < f.min) || (f.max !== undefined && n > f.max)) {
      const lo = f.min !== undefined ? String(f.min) : '−∞';
      const hi = f.max !== undefined ? String(f.max) : '∞';
      problems.push(`"${f.label}" must be between ${lo} and ${hi}.`);
    }
  }
  return problems;
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

/**
 * Shared by the LISFLOOD and TRITON Terrain steps (FIMSIM-FE51): the
 * coarser options are resampled from the 10 m 3DEP source, not native
 * 30 m / 90 m products — say so, or users assume a different dataset.
 */
export const DEM_RES_HELP =
  '10 m is the default and the native USGS 3DEP resolution. The 30 m and '
  + '90 m options are resampled from that 10 m source (not separate downloads) '
  + 'and run faster. The web app does not go below 10 m — for finer grids use '
  + 'the desktop FIMsim.';

/**
 * Which reference table the editable Manning's n table shows for a Roughness
 * step, or null when no table applies (fixed friction, other steps). The
 * LISFLOOD step keys its source as esri|nlcd; TRITON's is download|
 * download_nlcd (fimcore's own names) — both map onto the table's keys.
 */
export function manningTableSource(
  stepKey: string, get: (key: string) => unknown,
): 'esri' | 'nlcd' | null {
  if (stepKey !== 'manning' && stepKey !== 'tfric') return null;
  if (get('fric_mode') !== 'varying') return null;
  const src = stepKey === 'manning'
    ? String(get('lulc_download_source') || 'esri')
    : String(get('lulc_source') || 'download');
  return src === 'nlcd' || src === 'download_nlcd' ? 'nlcd' : 'esri';
}

export const STEP_FIELDS: Record<string, FieldSpec[]> = {
  dem: [
    {
      key: 'dem_input', label: 'Elevation input', widget: 'select',
      options: [
        { value: 'download', label: 'Download (USGS 3DEP)' },
        { value: 'upload', label: 'Upload my DEM GeoTIFF(s)' },
      ],
      help: 'Upload one or more GeoTIFFs (merged if several, resampled to the '
        + 'resolution below) instead of downloading elevation.',
    },
    {
      key: 'dem_res_m', label: 'Resolution', widget: 'select',
      options: [
        { value: 10, label: '10 m — default' },
        { value: 30, label: '30 m (faster, coarser)' },
        { value: 90, label: '90 m (fastest, coarsest)' },
      ],
      help: DEM_RES_HELP,
    },
  ],
  manning: [
    {
      key: 'fric_mode', label: 'Friction', widget: 'select',
      help: "Surface roughness (Manning's n) controls how much the ground slows "
        + 'the flow. From land cover assigns a value to each land-cover class '
        + '(forest is rougher than open water); fixed uses one value everywhere.',
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
      help: 'How the river enters the study area. Time-varying uses the '
        + 'hydrograph from the Flow Data step (a real event). Fixed applies one '
        + 'constant discharge for the whole run.',
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
      help: 'What happens where water leaves the study area. Free outflow lets '
        + 'it drain at its natural (normal) depth — needs a bed slope below. '
        + 'Fixed water level holds a set stage instead, e.g. a known tailwater '
        + 'or tidal level.',
      options: [
        { value: 'FREE', label: 'Free outflow (normal depth)' },
        { value: 'HFIX', label: 'Fixed water level' },
      ],
    },
    {
      key: 'downstream_slope', label: 'Bed slope at outflow', widget: 'number',
      showIf: { key: 'downstream_type', value: 'FREE' },
      // Real channel slopes: ~0.00002 (lower Amazon) up to ~0.1 where
      // cascade reaches begin; the spinner used to run negative and to 145.
      min: 0.00001, max: 0.1, step: 0.00001,
      help: 'The channel-bed slope at the downstream edge (m/m), used only for '
        + 'free (normal-depth) outflow. It sets how readily water drains out of '
        + 'the domain. 0.0001 — a gentle 1-in-10,000 grade — is a safe default '
        + 'for most lowland rivers: it lets flow leave without ponding at the '
        + 'boundary. Use a steeper value for steeper terrain; mountain streams '
        + 'run 0.01–0.05. Allowed range 0.00001 to 0.1.',
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
        { value: 'nwm_forecast', label: 'NWM forecast (2023 onwards)' },
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
      help: "LISFLOOD-FP's numerical scheme for moving water across the grid. "
        + 'Acceleration (the local-inertial solver) is fast and stable for most '
        + 'flood events and is recommended. Adaptive timestep and Diffusion are '
        + 'alternative schemes that trade speed for different physics.',
      options: [
        { value: 'acceleration', label: 'Acceleration (recommended)' },
        { value: 'adaptive_default', label: 'Adaptive timestep' },
        { value: 'diffusion', label: 'Diffusion' },
      ],
    },
    { key: 'sim_time', label: 'Simulation time (s)', widget: 'number',
      help: 'Leave blank to use the flow data’s full window.' },
    { key: 'initial_tstep', label: 'Computational timestep (s)', widget: 'number',
      help: 'The starting computational time step, in seconds. LISFLOOD-FP uses '
        + 'adaptive time stepping by default and adjusts the step during the run '
        + 'for numerical stability; if adaptive stepping is turned off, this value '
        + 'is used as a fixed step.' },
    { key: 'saveint', label: 'Output interval (s)', widget: 'number',
      help: 'How often the flood state is written out, producing the depth '
        + 'time series (the per-step water-depth grids used for the animation '
        + 'and the max-depth map). Smaller means more frames and larger files.' },
  ],
  // ── TRITON (deck generation — parity with the desktop tabs) ──
  tdem: [
    {
      key: 'dem_input', label: 'Elevation input', widget: 'select',
      options: [
        { value: 'download', label: 'Download (USGS 3DEP)' },
        { value: 'upload', label: 'Upload my DEM GeoTIFF(s)' },
      ],
      help: 'Upload one or more GeoTIFFs (merged if several, resampled to the '
        + 'resolution below) instead of downloading elevation.',
    },
    {
      key: 'dem_res_m', label: 'Resolution', widget: 'select',
      options: [
        { value: 10, label: '10 m — default' },
        { value: 30, label: '30 m (faster, coarser)' },
        { value: 90, label: '90 m (fastest, coarsest)' },
      ],
      help: DEM_RES_HELP,
    },
  ],
  tfric: [
    {
      key: 'fric_mode', label: 'Friction', widget: 'select',
      help: "Surface roughness (Manning's n) controls how much the ground slows "
        + 'the flow. From land cover assigns a value to each land-cover class '
        + '(forest is rougher than open water); fixed uses one value everywhere.',
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
      // bug-round #v/#vi: the default is visible in the field, follows the
      // type, and the spinner can't go negative / below 0.001
      min: 0.001, max: 2, step: 0.001,
      linkedDefault: { key: 'bc_type', values: { '2': 0.001, '3': 0.5 } },
      help: 'Bed slope for the normal-slope type (default 0.001, a gentle 1-in-1000 '
        + 'grade) or the Froude number for the Froude type (default 0.5). Must be '
        + 'between 0.001 and 2; ignored for free flow.',
    },
  ],
  thyg: [
    {
      key: 'bdy_source', label: 'Flow data source', widget: 'select',
      options: [
        { value: 'nwm_retro', label: 'NWM retrospective (1979–2023)' },
        { value: 'nwm_forecast', label: 'NWM forecast (2023 onwards)' },
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
    { key: 'print_interval', label: 'Output interval (s)', widget: 'number',
      help: 'How often TRITON writes a result frame, producing the depth time '
        + 'series. Smaller means more frames and larger files.' },
    {
      key: 'output_format', label: 'Output format', widget: 'select',
      help: 'File format for the result grids: ASCII is the most portable, '
        + 'GeoTIFF opens directly in GIS, binary is the most compact.',
      options: [
        { value: 'ASC', label: 'ASCII grids' },
        { value: 'GTIFF', label: 'GeoTIFF' },
        { value: 'BIN', label: 'Binary' },
      ],
    },
    {
      key: 'print_option', label: 'Outputs', widget: 'select',
      help: 'What each result frame stores. Depth + velocities (huv) keeps the '
        + 'flow speed and direction too; depth only (h) is smaller and enough '
        + 'for a flood-extent or max-depth map.',
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
