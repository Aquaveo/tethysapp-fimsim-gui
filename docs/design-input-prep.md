# Preparing Input Data on the web — design (2026-10-15)

Status: approved in conversation by Reshma Raghavan on 2026-10-15; tickets in
`docs/tickets-input-prep.md`. Reference: the desktop FIMsim (pnikrou/FIMsim)
landing page, `gui/mode_dem.py`, `gui/mode_lulc_manning.py`,
`gui/mode_flowline.py`, `gui/mode_streamflow.py`, and Test Case 3 (Lumber
River) in `test_case/README.md`.

## Purpose

The desktop FIMsim has two categories on its landing page: **Flood Mapping**
(complete model packages: LISFLOOD-FP, TRITON, later ARC-Curve2Flood) and
**Preparing Input Data** (four standalone tools that each produce one
model-independent input for a study area, with no simulation: DEM, LULC &
Manning's n, Flowline, Streamflow Data). The web app only has Flood Mapping.
This design adds the second category with desktop parity, so a hydrologist can
get a clipped DEM, a land-cover/Manning pair, the river network with gages, or
a discharge series for an area without configuring a model.

Success: the desktop's Test Case 3 (Lumber River, NC; HUC8 03040203; USGS gage
02134170) reproduced on the portal — all four tools run on that AOI, their
files download, and their previews show.

## Decisions (Reshma, 2026-10-15)

1. Two categories on the Project step, mirroring the desktop landing page;
   each tool is its own project mode (not one wizard with optional steps).
2. Round 1 is the four tools with downloads. Reuse of prepared outputs inside
   Flood Mapping steps is round 2 (Terrain and Flow Data first, where the
   upload hooks already exist: BE17 user DEM, BE22 CSV flow).
3. Streamflow Data keeps the Area step (the desktop has none): the area's
   lookup prefills the gage numbers and the main-river NWM reach; the user can
   still type or paste any IDs.

## Architecture

**Model per project, grown from two to six.** `Project.model` (FE48) takes
`dem-tool`, `lulc-tool`, `flowline-tool`, `flow-tool` next to `lisflood-fp`
and `triton`. `steps.ts MODELS` carries a `category` (`flood-mapping` |
`input-data`) and `runsOnPortal` stays `true` for the tools (they run here and
show results here). Slugs, `wizardPath`, the header badge (FE58), the project
list tag and the store-model validation all key off that field; nothing else
knows the difference. Existing projects are untouched.

**One options step per tool, on the generic step form.** A tool wizard is
Project → Area → *options* → Downloads. The options step is `StepPanel` with a
`STEP_FIELDS` entry, exactly like Terrain or Flow Data; the per-step outputs,
re-run, failure detail and downloads (FE49) come for free. Downloads is the
Results step (FE59) showing only its Input Data tab; the Results tab and the
run notice are hidden for tool projects (`hasRunStep=false` and no deck
wording — a small `kind` prop).

**Four job types, thin.** Each is a `UniformStepJobType` whose orchestrator is
the fimcore entry point the desktop already calls: `run_dem_mode`,
`run_lulc_mode` (orchestrate.py), `run_flowline_mode` (flowline_mode.py),
`run_streamflow_mode` (run_streamflow.py). They stage the AOI, build the one
per-area config dict those functions take, and collect the output folder. No
fimcore change is expected. Step keys `dem_tool`, `lulc_tool`,
`flowline_tool`, `flow_tool` join `models.STEP_KEYS`; `requires = ()` for all.

**Previews reuse what exists.** DEM → `write_dem_preview` + `RasterPreview`.
LULC & Manning → `write_manning_preview` + `RasterPreview` (official palettes,
BE23). Flowline → `write_boundary_preview` + `BoundaryPreview` (main river,
network, gages, endpoints). Streamflow → `HydrographChart` reading the CSV
(it already prefers a `discharge*.csv`).

## The four tools

| Tool | Fields (desktop parity) | fimcore call | Outputs |
|---|---|---|---|
| DEM | source `3dep` / `hand`; cell size (m, floor 10 as the web Terrain step; FE51 note); format `tif` / `gpkg` / `asc` | `run_dem_mode(project_dir, features, dem_cell_size_m, out_format, dem_source)` | `DEM_3DEP_<area>.<ext>` or `DEM_HAND_…`; terrain preview |
| LULC & Manning | source `nlcd` / `sentinel2` + published-year dropdown (FE28 lists); LULC format `tif` / `gpkg` / `asc`; build Manning on/off; Manning format `tif` / `gpkg` / `asc` / `shp`; Manning table (FE52 rules) | `run_lulc_mode(project_dir, features, per_aoi_configs=[…])` | `LULC_<area>.<ext>`, `ManningN_<area>.<ext>`; land-cover + roughness previews, class table |
| Flowline | main river on/off + format `shp` / `gpkg` / `tif` / `csv`; all flowlines on/off + format; gages CSV on/off; NWM feature IDs on/off; raster cell size for `tif` | `run_flowline_mode(project_dir, features, per_aoi_configs=[{save_main_river, main_format, save_all_flowlines, all_format, cell_size_m, save_gages_csv, save_feature_ids}])` | main river, flowlines, `gages.csv`, `feature_ids.csv`; boundary map preview |
| Streamflow Data | source `nwm_retro` / `nwm_forecast` / `usgs`; IDs (free text, prefilled from the area lookup); retro/USGS: start, end, interval h; forecast: `forecast_range` short/medium/long, `forecast_date`, `forecast_hour` (cycle) | `run_streamflow_mode(project_dir, configs=[{source, ids, start_dt, end_dt, interval_hours, forecast_range, forecast_date, forecast_hour}])` | one `discharge_<source>_<id>.csv` per ID; hydrograph chart |

Prefill for Streamflow: the Area lookup already stores the gages inside the AOI
(`Aoi.lookup.gages[].site_no`) and the main river; the Flow Data step resolves
the main-river NWM reach today. The options step seeds the IDs field with the
gage numbers for `usgs` and the reach ID for the NWM sources, when known.

## Validation and errors

Same style as the existing steps: `extra_config_keys` allow-list, choice checks,
number bands, FE28 published-year checks, non-empty ID list for Streamflow, at
least one output selected for Flowline, a clear reason on rejection. The job
runner's failure detail + re-run handle runtime errors (service down, no data
in the window).

## Project step

The "Model" radio list becomes two category cards with the desktop's copy:
Preparing Input Data ("Download and process the geospatial data needed to
configure a flood model" — DEM · LULC & Manning's n · Flowline · Streamflow
Data) and Flood Mapping ("Build a complete input package for a supported 2D
flood simulation model" — LISFLOOD-FP · TRITON). Picking a mode in either card
sets the project's model. The welcome modal gains one sentence on the second
category.

## Testing

- Frontend unit tests: category grouping and slug handling in `steps.ts`,
  field specs (visibility, bands, year lists), the Streamflow prefill helper.
- Backend unit tests: each job type's `check_values` and `transform_config`
  (desktop option names → fimcore kwargs), the models/step-key lists.
- Acceptance (manual, Reshma): Test Case 3 on the portal, each tool once.

## Out of scope (round 2 and later)

- Reuse of prepared outputs inside Flood Mapping steps (tickets FE66+/BE29+
  to be written after round 1).
- Multi-case input preparation (one area per project stands, #xi).
- HAND DEM for areas outside CONUS (the engine's existing limitation).
