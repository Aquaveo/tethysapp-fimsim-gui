// The LISFLOOD-FP wizard, as data. One entry per step; the rail, the panels,
// and (later) the per-step API wiring all key off this list, so adding a model
// later means adding a steps list — not new components.
export type StepId =
  | 'project'
  | 'aoi'
  | 'dem'
  | 'manning'
  | 'bci'
  | 'bdy'
  | 'par'
  | 'run'
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

export const STEPS: StepDef[] = [
  {
    id: 'project',
    label: 'Project',
    title: 'Project',
    blurb: 'Name the simulation project. Everything the run needs — inputs, model files, results — is stored under it.',
  },
  {
    id: 'aoi',
    label: 'Area of Interest',
    title: 'Area of Interest',
    blurb: 'Upload a shapefile or GeoPackage, or draw the study area on the map. Multiple areas become separate runs, processed in parallel.',
  },
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
  {
    id: 'results',
    label: 'Results',
    title: 'Results',
    blurb: 'View the flood map over the study area and download every generated file.',
  },
];
