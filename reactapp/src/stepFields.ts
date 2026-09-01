// reactapp/src/stepFields.ts
// Per-step form fields for the generic StepPanel. Keys are exactly the
// fimcore kwargs (BE7's config contract); labels are user-language.
export interface FieldSpec {
  key: string;
  label: string;
  widget: 'select' | 'number' | 'text' | 'datetime';
  options?: { value: string | number; label: string }[];
  help?: string;
  /** only show when another field has this value */
  showIf?: { key: string; value: unknown };
  required?: boolean;
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
      help: '10 m is the baseline product; finer grids increase simulation time substantially.',
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
      key: 'lulc_year', label: 'Land cover year', widget: 'number',
      showIf: { key: 'fric_mode', value: 'varying' },
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
    { key: 'start_dt', label: 'Event start', widget: 'datetime', required: true },
    { key: 'end_dt', label: 'Event end', widget: 'datetime', required: true },
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
