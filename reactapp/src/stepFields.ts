// reactapp/src/stepFields.ts
// Per-step form fields for the generic StepPanel. Keys are exactly the
// fimcore kwargs (BE7's config contract); labels are user-language.
import { HARD_N } from './manningRules';

export interface Condition { key: string; value: unknown }

export interface FieldSpec {
  key: string;
  label: string;
  widget: 'select' | 'number' | 'text' | 'datetime' | 'date' | 'checkbox';
  options?: { value: string | number; label: string }[];
  help?: string;
  /** only show when another field has this value; an array means ALL must hold */
  showIf?: Condition | Condition[];
  /** hide when another field has this value (any of them); checked after showIf */
  hideIf?: Condition | Condition[];
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

/** Whether a field is visible: every showIf holds and no hideIf holds. */
export function fieldVisible(
  showIf: FieldSpec['showIf'], get: (key: string) => unknown, hideIf?: FieldSpec['hideIf'],
): boolean {
  const show = showIf ? (Array.isArray(showIf) ? showIf : [showIf]) : [];
  if (!show.every((c) => get(c.key) === c.value)) return false;
  const hide = hideIf ? (Array.isArray(hideIf) ? hideIf : [hideIf]) : [];
  return !hide.some((c) => get(c.key) === c.value);
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

/** The tools take any cell size ≥ 10 m (FE51 floor), not a 10/30/90 pick. */
export const TOOL_CELL_HELP =
  '10 m is the native USGS 3DEP resolution; coarser cells are resampled from '
  + 'it. The web app does not go below 10 m — for finer grids use the desktop FIMsim.';

/** fimcore.export.export_raster formats (DEM, LULC and Manning exports). */
export const RASTER_FORMAT_OPTIONS = [
  { value: 'tif', label: 'GeoTIFF (.tif)' },
  { value: 'gpkg', label: 'GeoPackage (.gpkg)' },
  { value: 'asc', label: 'ASCII grid (.asc)' },
];

/** fimcore.flowline_mode per-output formats (desktop aoi_flowline_card). */
export const FLOWLINE_FORMAT_OPTIONS = [
  { value: 'shp', label: 'Shapefile (.shp)' },
  { value: 'gpkg', label: 'GeoPackage (.gpkg)' },
  { value: 'tif', label: 'TIF raster (.tif)' },
  { value: 'csv', label: 'CSV with WKT geometry (.csv)' },
];

/**
 * Which preview a succeeded run of a step shows (StepPanel keys its preview
 * components off this, so the tools (FE61–FE64) reuse the LISFLOOD/TRITON
 * components without new branches).
 */
export type PreviewKind = 'dem' | 'lulc' | 'boundary' | 'hydrograph';
const PREVIEW_STEPS: Record<PreviewKind, readonly string[]> = {
  dem: ['dem', 'tdem', 'dem_tool'],
  lulc: ['manning', 'tfric', 'lulc_tool'],
  boundary: ['bci', 'tbc', 'flowline_tool'],
  hydrograph: ['bdy', 'thyg', 'flow_tool'],
};
export function previewKind(stepKey: string): PreviewKind | null {
  for (const kind of Object.keys(PREVIEW_STEPS) as PreviewKind[]) {
    if (PREVIEW_STEPS[kind].includes(stepKey)) return kind;
  }
  return null;
}

/**
 * Which reference table the editable Manning's n table shows for a Roughness
 * step, or null when no table applies (fixed friction, other steps). The
 * LISFLOOD step keys its source as esri|nlcd; TRITON's is download|
 * download_nlcd (fimcore's own names) — both map onto the table's keys.
 */
export function manningTableSource(
  stepKey: string, get: (key: string) => unknown,
): 'esri' | 'nlcd' | null {
  if (stepKey === 'lulc_tool') {
    // FE62: the standalone tool keys the table off its do_manning checkbox
    // and fimcore's own source names (nlcd | sentinel2)
    if (get('do_manning') !== true) return null;
    return String(get('lulc_source') || 'nlcd') === 'nlcd' ? 'nlcd' : 'esri';
  }
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
      min: HARD_N.min, max: HARD_N.max, step: 0.001,
      help: `One roughness value for the whole domain, between ${HARD_N.min} and `
        + `${HARD_N.max}. Typical: 0.030 open water/short grass, 0.045 mixed, `
        + '0.080 built-up or dense vegetation.',
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
      min: HARD_N.min, max: HARD_N.max, step: 0.001,
      help: `One roughness value for the whole domain, between ${HARD_N.min} and `
        + `${HARD_N.max}. Typical: 0.030 open water/short grass, 0.045 mixed, `
        + '0.080 built-up or dense vegetation.',
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
    // No user time limit (FIMSIM-FE50): the budget is a server setting; the
    // step shows a typical-runtime hint instead.
    {
      key: 'keep_snapshots', label: 'Depth time series', widget: 'select',
      options: [
        { value: 'false', label: 'Max-depth map only (default)' },
        { value: 'true', label: 'Also keep every depth snapshot (zip)' },
      ],
      help: 'Snapshots are one grid per output interval — for animations; adds a large zip.',
    },
  ],
  // ── Preparing Input Data tools (desktop Track A — FIMSIM-FE61…FE64).
  //    Keys are fimcore's standalone-mode option names. ──
  dem_tool: [
    {
      key: 'dem_source', label: 'Elevation source', widget: 'select',
      options: [
        { value: '3dep', label: 'USGS 3DEP (1/3 arc-second ≈ 10 m, CONUS)' },
        { value: 'hand', label: 'HAND — height above nearest drainage (UT Austin, CONUS)' },
      ],
      help: '3DEP is the bare-earth elevation. HAND is each cell\'s height above '
        + 'the nearest stream — the input for HAND-FIM style mapping.',
    },
    {
      key: 'dem_res_m', label: 'Cell size (m)', widget: 'number',
      min: 10, max: 1000, step: 1, help: TOOL_CELL_HELP,
    },
    { key: 'out_format', label: 'File format', widget: 'select', options: RASTER_FORMAT_OPTIONS },
  ],
  lulc_tool: [
    {
      key: 'lulc_source', label: 'Land cover source', widget: 'select',
      options: [
        { value: 'nlcd', label: 'NLCD (USGS, 30 m, USA)' },
        { value: 'sentinel2', label: 'Esri Sentinel-2 (10 m, global)' },
      ],
    },
    {
      key: 'nlcd_year', label: 'NLCD year', widget: 'select', options: NLCD_YEAR_OPTIONS,
      showIf: { key: 'lulc_source', value: 'nlcd' },
    },
    {
      key: 'sentinel2_year', label: 'Sentinel-2 year', widget: 'select',
      options: SENTINEL2_YEAR_OPTIONS, showIf: { key: 'lulc_source', value: 'sentinel2' },
    },
    {
      key: 'cell_size_m', label: 'Cell size (m)', widget: 'number',
      min: 10, max: 1000, step: 1,
      // desktop aoi_lulc_card: the source's native size when the source changes
      linkedDefault: { key: 'lulc_source', values: { nlcd: 30, sentinel2: 10 } },
      help: 'NLCD is published at 30 m and Sentinel-2 at 10 m; any other size is '
        + 'resampled. ' + TOOL_CELL_HELP,
    },
    { key: 'lulc_format', label: 'Land cover format', widget: 'select', options: RASTER_FORMAT_OPTIONS },
    {
      key: 'do_manning', label: "Also build the Manning's n grid", widget: 'checkbox',
      help: "Assigns a roughness value to every land-cover class from the table "
        + 'below and writes it as a second file.',
    },
    {
      key: 'manning_format', label: "Manning's n format", widget: 'select',
      showIf: { key: 'do_manning', value: true },
      options: [...RASTER_FORMAT_OPTIONS, { value: 'shp', label: 'Shapefile (.shp, polygonized)' }],
    },
  ],
  flowline_tool: [
    { key: 'save_main_river', label: 'Main river (NHD highest stream order)', widget: 'checkbox' },
    {
      key: 'main_format', label: 'Main river format', widget: 'select',
      showIf: { key: 'save_main_river', value: true }, options: FLOWLINE_FORMAT_OPTIONS,
    },
    { key: 'save_all_flowlines', label: 'All flowlines (full NHD reach set)', widget: 'checkbox' },
    {
      key: 'all_format', label: 'Flowlines format', widget: 'select',
      showIf: { key: 'save_all_flowlines', value: true }, options: FLOWLINE_FORMAT_OPTIONS,
    },
    {
      key: 'cell_size_m', label: 'Cell size for TIF (m)', widget: 'number',
      min: 10, max: 10000, step: 1,
      help: 'Only used when a TIF raster is chosen: the lines are burned into a '
        + '1 / 0 grid at this cell size.',
    },
    {
      key: 'save_gages_csv', label: 'USGS gages as CSV', widget: 'checkbox',
      help: 'Site number, name, coordinates and drainage area of every gage inside the area.',
    },
    {
      key: 'save_feature_ids', label: 'NWM feature IDs as CSV', widget: 'checkbox',
      help: 'The NHDPlus COMID of every reach \u2014 paste them into the Streamflow Data tool.',
    },
  ],
  flow_tool: [
    {
      key: 'source', label: 'Data source', widget: 'select',
      options: [
        { value: 'nwm_retro', label: 'NWM retrospective (1979-02 → 2023-01)' },
        { value: 'nwm_forecast', label: 'NWM forecast (2018-09 onwards; short / medium / long range)' },
        { value: 'usgs', label: 'USGS gage (observed, 15-minute)' },
      ],
    },
    {
      key: 'ids', label: 'IDs', widget: 'text', required: true,
      help: 'NWM feature IDs (NHDPlus COMIDs) or USGS gage numbers, comma or space '
        + 'separated. Prefilled from the area lookup when known — edit freely. '
        + 'One CSV is written per ID.',
    },
    {
      key: 'start_dt', label: 'Start (date)', widget: 'date', required: true,
      hideIf: { key: 'source', value: 'nwm_forecast' },
    },
    {
      key: 'end_dt', label: 'End (date)', widget: 'date', required: true, endOfDay: true,
      hideIf: { key: 'source', value: 'nwm_forecast' },
    },
    {
      key: 'interval_hours', label: 'Interval', widget: 'select',
      hideIf: { key: 'source', value: 'nwm_forecast' },
      options: [
        { value: 0.25, label: '15 min' }, { value: 0.5, label: '30 min' },
        { value: 1, label: '1 h' }, { value: 3, label: '3 h' }, { value: 6, label: '6 h' },
        { value: 12, label: '12 h' }, { value: 24, label: '24 h' },
      ],
      help: 'The NWM retrospective is hourly; USGS gages report every 15 minutes. '
        + 'Coarser intervals average the readings.',
    },
    {
      key: 'forecast_range', label: 'Forecast range', widget: 'select',
      showIf: { key: 'source', value: 'nwm_forecast' },
      options: [
        { value: 'short_range', label: 'Short range (18 h)' },
        { value: 'medium_range', label: 'Medium range (10 days)' },
        { value: 'long_range', label: 'Long range (30 days)' },
      ],
    },
    {
      key: 'forecast_date', label: 'Issue date', widget: 'date', required: true,
      showIf: { key: 'source', value: 'nwm_forecast' },
      help: 'The day the forecast was issued (2018-09-17 onwards).',
    },
    {
      key: 'forecast_hour', label: 'Cycle (UTC)', widget: 'select',
      showIf: { key: 'source', value: 'nwm_forecast' },
      options: [
        { value: '', label: 'Auto (latest cycle)' },
        { value: 0, label: '00' }, { value: 6, label: '06' },
        { value: 12, label: '12' }, { value: 18, label: '18' },
      ],
    },
  ],
};
