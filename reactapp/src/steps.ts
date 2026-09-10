// The wizards, as data. One steps list per MODEL; the rail, the panels, and
// the per-step API wiring all key off these lists, so adding a model means
// adding a list — not new components. LISFLOOD-FP runs on the cluster;
// TRITON (alpha) generates the complete model input deck for download —
// parity with the desktop, which also hands the TRITON package to the user
// to run on their own GPU/HPC.
export type StepId =
  | 'project'
  | 'aoi'
  | 'dem'
  | 'manning'
  | 'bci'
  | 'bdy'
  | 'par'
  | 'run'
  | 'tdem'
  | 'tfric'
  | 'tbc'
  | 'thyg'
  | 'tcfg'
  | 'results';

export interface StepDef {
  id: StepId;
  /** Short label shown on the rail node. */
  label: string;
  /** Panel heading. */
  title: string;
  /** What this step will do — real copy, shown in the placeholder panel. */
  blurb: string;
  /** The file/artifact the step produces, when it has one. */
  produces?: string;
}

export type ModelId = 'lisflood-fp' | 'triton';

const PROJECT_STEP: StepDef = {
  id: 'project',
  label: 'Project',
  title: 'Project',
  blurb: 'Name the simulation project. Everything the run needs — inputs, model files, results — is stored under it.',
};

const AOI_STEP: StepDef = {
  id: 'aoi',
  label: 'Area of Interest',
  title: 'Area of Interest',
  blurb: 'Upload a shapefile or GeoPackage, or draw the study area on the map. Multiple areas become separate runs, processed in parallel.',
};

const RESULTS_STEP: StepDef = {
  id: 'results',
  label: 'Results',
  title: 'Results',
  blurb: 'View the flood map over the study area and download every generated file.',
};

const LISFLOOD_STEPS: StepDef[] = [
  PROJECT_STEP,
  AOI_STEP,
  {
    id: 'dem',
    label: 'Terrain',
    title: 'Terrain (DEM)',
    blurb: 'Download USGS 3DEP elevation for each area and grid it to the resolution you choose.',
    produces: 'dem.ascii',
  },
  {
    id: 'manning',
    label: 'Roughness',
    title: "Roughness (Manning's n)",
    blurb: "Fetch land cover and build the Manning's n table — editable per land-cover class before it becomes a roughness grid.",
    produces: 'lulc.ascii',
  },
  {
    id: 'bci',
    label: 'Boundaries',
    title: 'Boundary Conditions',
    blurb: 'Detect the main river through the study area and set the upstream inflow and downstream outflow boundaries.',
    produces: '.bci',
  },
  {
    id: 'bdy',
    label: 'Flow Data',
    title: 'Flow Data',
    blurb: 'Pull streamflow for your event window — National Water Model retrospective or forecast, a USGS gage, or your own table.',
    produces: '.bdy',
  },
  {
    id: 'par',
    label: 'Settings',
    title: 'Simulation Settings',
    blurb: 'Solver, timestep, and output options for LISFLOOD-FP. Sensible defaults; change only what you need.',
    produces: 'model.par',
  },
  {
    id: 'run',
    label: 'Run',
    title: 'Run Simulation',
    blurb: 'Submit the simulation to the compute cluster and watch progress — one job per study area, run concurrently.',
  },
  RESULTS_STEP,
];

const TRITON_STEPS: StepDef[] = [
  PROJECT_STEP,
  AOI_STEP,
  {
    id: 'tdem',
    label: 'Terrain',
    title: 'Terrain (DEM)',
    blurb: "Download USGS 3DEP elevation for each area and grid it to TRITON's ASCII format at the resolution you choose.",
    produces: 'dem.asc',
  },
  {
    id: 'tfric',
    label: 'Friction',
    title: 'Friction (Manning’s n)',
    blurb: "Fetch land cover and build TRITON's friction grid — a headerless Manning's n matrix aligned to the terrain.",
    produces: 'friction.asc',
  },
  {
    id: 'tbc',
    label: 'Boundaries',
    title: 'Boundary Conditions',
    blurb: 'Detect where the main river enters and leaves the study area: the inflow source point and the downstream external boundary.',
    produces: '.src + .extbc',
  },
  {
    id: 'thyg',
    label: 'Hydrograph',
    title: 'Hydrograph',
    blurb: 'Pull the inflow discharge for your event window — National Water Model retrospective or forecast, or a USGS gage.',
    produces: '.hyg',
  },
  {
    id: 'tcfg',
    label: 'Config',
    title: 'TRITON Configuration',
    blurb: 'Generate the TRITON control file. File references, source counts, and simulation duration are filled in automatically.',
    produces: '.cfg',
  },
  {
    ...RESULTS_STEP,
    blurb: 'Download the complete TRITON input deck — ready to run on your own GPU/HPC system.',
  },
];

export const MODELS: Record<ModelId, { label: string; steps: StepDef[]; runsOnPortal: boolean }> = {
  'lisflood-fp': { label: 'LISFLOOD-FP', steps: LISFLOOD_STEPS, runsOnPortal: true },
  triton: { label: 'TRITON', steps: TRITON_STEPS, runsOnPortal: false },
};

export const DEFAULT_MODEL: ModelId = 'lisflood-fp';

/** Back-compat export — the LISFLOOD wizard (existing imports/tests). */
export const STEPS: StepDef[] = LISFLOOD_STEPS;
