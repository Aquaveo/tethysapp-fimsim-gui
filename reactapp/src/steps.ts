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
  | 'dem_tool'
  | 'lulc_tool'
  | 'flowline_tool'
  | 'flow_tool'
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

export type ModelId =
  | 'lisflood-fp' | 'triton'
  | 'dem-tool' | 'lulc-tool' | 'flowline-tool' | 'flow-tool';

/** The desktop landing page's two categories (FIMSIM-FE60). */
export type CategoryId = 'flood-mapping' | 'input-data';

export interface ModelDef {
  label: string;
  steps: StepDef[];
  /** true = the job steps run here and show results here */
  runsOnPortal: boolean;
  category: CategoryId;
  /** one-line note under the name on the Project step card */
  note: string;
}

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
    label: 'Roughness',
    title: "Roughness (Manning's n)",
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
    label: 'Flow Data',
    title: 'Flow Data',
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

// ── Preparing Input Data (desktop Track A, FIMSIM-FE60): each tool is one
// job step between Area and Downloads; the step id IS the backend step key.
const DOWNLOADS_STEP: StepDef = {
  id: 'results',
  label: 'Downloads',
  title: 'Downloads',
  blurb: 'Download the files this tool produced. Re-run the previous step with other options to replace them.',
};

const toolSteps = (options: StepDef): StepDef[] => [PROJECT_STEP, AOI_STEP, options, DOWNLOADS_STEP];

const DEM_TOOL_STEPS = toolSteps({
  id: 'dem_tool',
  label: 'DEM',
  title: 'DEM (elevation)',
  blurb: 'Download USGS 3DEP or HAND elevation clipped to the study area, at the cell size and file format you choose.',
  produces: 'DEM_<source>_<area>',
});
const LULC_TOOL_STEPS = toolSteps({
  id: 'lulc_tool',
  label: 'LULC & Manning',
  title: "Land Cover & Manning's n",
  blurb: "Download NLCD or Esri Sentinel-2 land cover for the area and, optionally, build the Manning's n roughness grid from the editable class table.",
  produces: 'LULC_<area> + ManningN_<area>',
});
const FLOWLINE_TOOL_STEPS = toolSteps({
  id: 'flowline_tool',
  label: 'Flowline',
  title: 'Flowline (NHD rivers & USGS gages)',
  blurb: 'Save the main river and the full NHD reach network crossing the area, the USGS gages inside it, and the NWM feature IDs.',
  produces: 'main_river_<area> …',
});
const FLOW_TOOL_STEPS = toolSteps({
  id: 'flow_tool',
  label: 'Streamflow',
  title: 'Streamflow Data',
  blurb: 'Download a discharge time series for NWM reaches or USGS gages — retrospective, forecast or observed — one CSV per ID.',
  produces: 'one discharge CSV per ID',
});

export const MODELS: Record<ModelId, ModelDef> = {
  'lisflood-fp': {
    label: 'LISFLOOD-FP', category: 'flood-mapping', steps: LISFLOOD_STEPS, runsOnPortal: true,
    note: 'Runs on the portal — results and flood maps here.',
  },
  triton: {
    label: 'TRITON', category: 'flood-mapping', steps: TRITON_STEPS, runsOnPortal: false,
    note: 'Deck only — builds the input files to run on your own GPU/HPC.',
  },
  'dem-tool': {
    label: 'DEM', category: 'input-data', steps: DEM_TOOL_STEPS, runsOnPortal: true,
    note: '3DEP · HAND · TIF / GPKG / ASC',
  },
  'lulc-tool': {
    label: "LULC & Manning's n", category: 'input-data', steps: LULC_TOOL_STEPS, runsOnPortal: true,
    note: 'NLCD · Sentinel-2 · Manning table',
  },
  'flowline-tool': {
    label: 'Flowline', category: 'input-data', steps: FLOWLINE_TOOL_STEPS, runsOnPortal: true,
    note: 'NHD flowlines · USGS gages',
  },
  'flow-tool': {
    label: 'Streamflow Data', category: 'input-data', steps: FLOW_TOOL_STEPS, runsOnPortal: true,
    note: 'NWM Retro / Forecast · USGS',
  },
};

/** The two cards on the Project step — the desktop's copy, input data first. */
export const CATEGORIES: { id: CategoryId; title: string; description: string }[] = [
  {
    id: 'input-data',
    title: 'Preparing Input Data',
    description: 'Download and process the geospatial data needed to configure a flood model.',
  },
  {
    id: 'flood-mapping',
    title: 'Flood Mapping',
    description: 'Build a complete input package for a supported 2D flood simulation model.',
  },
];

export function modelsInCategory(category: CategoryId): ModelId[] {
  return (Object.keys(MODELS) as ModelId[]).filter((m) => MODELS[m].category === category);
}

export function isToolModel(model: ModelId): boolean {
  return MODELS[model].category === 'input-data';
}

/** What the last step shows (FIMSIM-FE65): the flood map + files, the TRITON
 *  deck download, or just the tool's files (Downloads). */
export type ResultsKind = 'simulation' | 'deck' | 'tools';
export function resultsKind(model: ModelId): ResultsKind {
  if (isToolModel(model)) return 'tools';
  return MODELS[model].runsOnPortal ? 'simulation' : 'deck';
}

/**
 * The CSS modifier for a model's badge / tag everywhere it appears (header,
 * step card, project list): '' = cyan (runs here), ' is-deck' = purple
 * (TRITON deck), ' is-tool' = green (Preparing Input Data, the desktop's
 * card accent).
 */
export function modelBadgeClass(model: ModelId): '' | ' is-deck' | ' is-tool' {
  if (isToolModel(model)) return ' is-tool';
  return MODELS[model].runsOnPortal ? '' : ' is-deck';
}

export const DEFAULT_MODEL: ModelId = 'lisflood-fp';

/** A URL slug (or nothing) → a model id; unknown slugs fall back to the default. */
export function modelFromSlug(slug: string | null | undefined): ModelId {
  return slug && slug in MODELS ? (slug as ModelId) : DEFAULT_MODEL;
}

/**
 * The wizard link for a project (FIMSIM-FE48). The model is a property of
 * the project, so EVERY link into the wizard is built here — an unslugged
 * /new/<id> silently meant LISFLOOD, which is how TRITON projects "flipped".
 */
export function wizardPath(project: { id: number; model?: string | null }): string {
  const model = modelFromSlug(project.model);
  return model === DEFAULT_MODEL ? `/new/${project.id}` : `/new/${project.id}/${model}`;
}

/**
 * A step that is safe to render for the given model's step list.
 * Switching models can leave `step` pointing at a step the new model lacks
 * (e.g. LISFLOOD "run" → TRITON), which would index past the steps array and
 * crash on `def.title`. Fall back to a step every model shares.
 */
export function resolveActiveStep(
  steps: StepDef[], step: StepId, hasProject: boolean,
): StepId {
  if (steps.some((s) => s.id === step)) return step;
  return hasProject ? 'aoi' : 'project';
}

/** Back-compat export — the LISFLOOD wizard (existing imports/tests). */
export const STEPS: StepDef[] = LISFLOOD_STEPS;

/**
 * FIMSIM-FE56 — simulations take 3–4 h, so users click Next past the Run
 * step. Leaving Run FORWARD (Next, or a rail jump to a later step) with no
 * AOI whose run succeeded must be confirmed first. Going back never asks;
 * models without a Run step (TRITON) never ask.
 */
export function needsRunConfirm(
  steps: StepDef[], from: StepId, to: StepId,
  aois: { steps?: Record<string, { status: string }> }[],
): boolean {
  if (from !== 'run') return false;
  const fromIdx = steps.findIndex((s) => s.id === from);
  const toIdx = steps.findIndex((s) => s.id === to);
  if (fromIdx < 0 || toIdx <= fromIdx) return false;
  return !aois.some((a) => a.steps?.run?.status === 'succeeded');
}

/**
 * FIMSIM-FE55 — a rail step is ✓ only when it REALLY completed, never by
 * position, so a skipped step (e.g. Run) keeps its number. Project is done
 * once a project exists, AOI once an area exists, a job step once its run
 * succeeded for every AOI; Results is the end and is never "done".
 */
export function stepDone(
  id: StepId,
  aois: { steps?: Record<string, { status: string }> }[],
  hasProject: boolean,
): boolean {
  if (id === 'project') return hasProject;
  if (id === 'aoi') return aois.length > 0;
  if (id === 'results') return false;
  return aois.length > 0 && aois.every((a) => a.steps?.[id]?.status === 'succeeded');
}

/**
 * FIMSIM-FE58 — the header badge names the project's model, but only once a
 * project is open (/new/<id>…); the bare Project step (/new) has no model yet.
 */
export function headerModel(projectId: number | null, model: ModelId): ModelId | null {
  return projectId ? model : null;
}
