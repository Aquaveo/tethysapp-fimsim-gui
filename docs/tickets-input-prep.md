# Preparing Input Data on the web — tickets (2026-10-15)

Context: the desktop FIMsim's landing page has two categories, Flood Mapping
(LISFLOOD-FP, TRITON, later ARC-Curve2Flood) and Preparing Input Data (four
standalone tools: DEM, LULC & Manning's n, Flowline, Streamflow Data). The web
app only has Flood Mapping. Design approved 2026-10-15 — see
docs/design-input-prep.md. Round 1 =
the category + the four tools with downloads; reuse of prepared outputs inside
Flood Mapping steps is round 2 (tickets to follow). Numbers follow the scrum board
(filed 2026-10-20: BE18 = WP 23478; FE60–FE65 = WP 23479–23484). Build order: BE18 → FE60 → FE61 → FE62 → FE63 →
FE64 → FE65.

—

TASK GROUP: BYU CIROH: FIMsim GUI – Preparing Input Data (desktop Track-A parity)

🎯 Goal: a user can get a clipped DEM, a land-cover + Manning's n pair, the
river network with gages, or a discharge time series for a study area on the
portal without configuring a model — the desktop's Preparing Input Data
category, same options, same outputs.

🛠️ What will be done: the project model grows to six values grouped in two
categories on the Project step; four thin job types call fimcore's existing
standalone entry points; each tool is a one-step wizard on the generic step
form with the existing previews and downloads.

📋 Subtasks: BE18, FE60, FE61, FE62, FE63, FE64, FE65 below.

🚦 Status: 🔜 To Do

—

TASK: BYU CIROH: FIMsim GUI – [Feature] Backend: Tool Modes + Four Standalone Job Types (FIMSIM-BE18)

Description: Add the four tool modes to the project model and register four
job types that wrap fimcore's standalone entry points (run_dem_mode,
run_lulc_mode, run_flowline_mode, run_streamflow_mode) the way the desktop
calls them. Thin wrappers: stage the AOI, build the per-area config, collect
the output folder. No fimcore change expected.

[   ]  models: MODELS = (lisflood-fp, triton, dem-tool, lulc-tool, flowline-tool, flow-tool); STEP_KEYS gains dem_tool, lulc_tool, flowline_tool, flow_tool; normalize_model accepts the new slugs
[   ]  Job types dem_tool / lulc_tool / flowline_tool / flow_tool registered, requires = (), each calling its fimcore entry point with the desktop's option names mapped in transform_config
[   ]  check_values per tool: choices (source/format), number bands (cell size ≥ 10 m, interval h), FE28 published years for lulc_tool, non-empty IDs for flow_tool, ≥ 1 output selected for flowline_tool — clear reasons
[   ]  collect() writes the existing previews: dem_tool → terrain preview; lulc_tool → land-cover + roughness previews (official palettes); flowline_tool → boundary map preview; flow_tool → discharge CSV(s) the hydrograph chart reads
[   ]  Unit tests: validation per tool, transform_config option mapping, the models/step-key lists; flake8 clean

Implementation Tasks
- job_types/steps_tools.py: four UniformStepJobType subclasses (+ a ToolMixin that marks the scratch project as a tool one, as TritonDeckMixin does)
- models.py lists; registry wiring; api/steps schema exposes the new defaults
- flow_tool: configs list = one dict per ID group {source, ids, start_dt, end_dt, interval_hours, forecast_range, forecast_date, forecast_hour}

Out of Scope: reuse of outputs in Flood Mapping steps (round 2); multi-area projects (#xi stands).

—

TASK: BYU CIROH: FIMsim GUI – [Feature] Project Step: Flood Mapping / Preparing Input Data Categories (FIMSIM-FE60)

Description: The Project step's "Model" radio list becomes the desktop's two
category cards: Preparing Input Data (DEM · LULC & Manning's n · Flowline ·
Streamflow Data) and Flood Mapping (LISFLOOD-FP · TRITON). Picking a mode in
either card sets the project's model; the header badge, project-list tag and
URL slug follow.

[   ]  Two category cards with the desktop's copy; each lists its modes with a one-line note; selection sets project.model
[   ]  steps.ts MODELS carries category + a steps list per tool mode (Project → Area → options → Downloads); wizardPath / modelFromSlug handle the four new slugs
[   ]  Header badge (FE58) and project-list tag show the tool name in the input-data colour (green), Flood Mapping modes keep cyan / purple
[   ]  Welcome modal: one sentence introducing the second category
[   ]  Unit tests: category grouping, slug round-trip, steps per mode

Implementation Tasks
- steps.ts: ModelId union + MODELS entries + CATEGORIES; ProjectStep.tsx cards; ProjectStep.css; Header/ProjectStep colour class
- NewSimulation: nothing model-specific beyond MODELS (verify JOB_STEPS derivation)

Out of Scope: ARC-Curve2Flood card (paused, FIMSIM ARC tickets).

—

TASK: BYU CIROH: FIMsim GUI – [Feature] DEM Tool (FIMSIM-FE61)

Description: The DEM tool's options step on the generic step form: elevation
source 3DEP or HAND, cell size, output format TIF / GPKG / ASC. Output
DEM_<SOURCE>_<area>.<ext> with the terrain preview; download on the step and
on Downloads.

[   ]  Fields: dem_source (3dep | hand), dem_res_m (≥ 10, FE51 resampling note), out_format (tif | gpkg | asc)
[   ]  Terrain raster preview + stats shown on success; per-file download + zip (FE49); Downloads step lists the file (FE59 Input Data tab only)
[   ]  Lumber River (Test Case 3): a 10 m 3DEP TIF clipped to the AOI, elevations ≈ 30–55 m

Implementation Tasks
- stepFields.ts dem_tool entry; steps.ts blurb/produces; StepPanel preview wiring keyed on dem_tool

—

TASK: BYU CIROH: FIMsim GUI – [Feature] LULC & Manning Tool (FIMSIM-FE62)

Description: Land cover + Manning's n as a standalone product: source NLCD or
Sentinel-2 with the published-year dropdown, LULC format, optional Manning's n
build with its own format and the editable Manning table (FE52 rules: hard
band + per-class warnings).

[   ]  Fields: lulc_source (nlcd | sentinel2), year (FE28 lists), lulc_format (tif | gpkg | asc), do_manning, manning_format (tif | gpkg | asc | shp), manning_mapping via ManningTable
[   ]  Land-cover + roughness previews with the official palettes and the class-breakdown table (BE12/BE23)
[   ]  Lumber River: breakdown dominated by cultivated crops and woody wetlands; LULC and ManningN files download

Implementation Tasks
- stepFields.ts lulc_tool entry (manningTableSource extended to lulc_tool); steps.ts; StepPanel preview wiring

—

TASK: BYU CIROH: FIMsim GUI – [Feature] Flowline Tool (FIMSIM-FE63)

Description: NHD flowlines and USGS gages for the area: the main river
(highest stream order) in SHP / GPKG / TIF raster / CSV, optionally all
flowlines, the gages list as CSV, and the NWM feature IDs.

[   ]  Fields: save_main_river + main_format, save_all_flowlines + all_format, save_gages_csv, save_feature_ids, cell_size_m (for tif); at least one output required
[   ]  Boundary-style map preview: main river, full network, gages, detected endpoints
[   ]  Lumber River: main channel + network + gage 02134170 on the map; files download

Implementation Tasks
- stepFields.ts flowline_tool entry; steps.ts; StepPanel preview wiring (BoundaryPreview)

—

TASK: BYU CIROH: FIMsim GUI – [Feature] Streamflow Data Tool (FIMSIM-FE64)

Description: Discharge time series by ID: NWM Retrospective (1979–2023),
NWM Forecast (2018-09–now; short / medium / long range, issue date, cycle) or
USGS gage, with date window and interval. The Area step stays (decision
2026-10-15): its lookup prefills the gage numbers and the main-river NWM
reach; the user can type or paste any IDs.

[   ]  Fields: source (nwm_retro | nwm_forecast | usgs), ids (free text, comma/space separated), start_dt / end_dt / interval_hours (retro, usgs), forecast_range / forecast_date / forecast_hour (forecast)
[   ]  IDs prefilled from the area lookup when known (gages for usgs, reach for NWM); editable
[   ]  One CSV per ID; the hydrograph chart shows each series with date ticks (FE53)
[   ]  Lumber River: USGS 02134170, 2016-10-01 → 2016-10-19, 1 h → peak ≈ 410 m³/s around Oct 11

Implementation Tasks
- stepFields.ts flow_tool entry with showIf per source; a prefillIds(aoi, source) helper (unit-tested); StepPanel seeds the field once per AOI
- HydrographChart: handle several discharge CSVs in one run (one series each)

Out of Scope: a CSV of IDs upload (desktop "Browse CSV"); add later if asked.

—

TASK: BYU CIROH: FIMsim GUI – [Feature] Downloads Step + Docs for Tool Projects (FIMSIM-FE65)

Description: Tool projects end on a Downloads step: the Results step showing
its Input Data tab only (no Results tab, no run notice, no deck wording). The
documentation page gains a Preparing Input Data section (four tools, options,
outputs), mirroring the desktop manual's Part 1.

[   ]  Results step takes a kind prop (simulation | deck | tools); tools → Input Data tab only, titled Downloads
[   ]  Docs page: Preparing Input Data section with the four tools' options and output files
[   ]  Stepper labels / blurbs read right for each tool mode (rail shows Project · Area · <Tool> · Downloads)

Implementation Tasks
- ResultsStep.tsx kind prop; steps.ts per-mode Downloads step def; Docs.tsx section

Notes: acceptance for the whole group = Test Case 3 (Lumber River) run end to end on the portal by Reshma.
