# A2F (ARC-Curve2Flood) on the portal — design

Status: DRAFT for Reshma's review (2026-11-12). Nothing here is built yet.
Engine: fimcore `arc/sync-desktop-958951e` (fimcore PR #1), which reproduces
Parvaneh's Test Case 3 depth map cell for cell.

## Scope (v1, approved 2026-11-12)

Same steps as Parvaneh's desktop:

| # | Step | What the user picks | fimcore call |
|---|------|---------------------|--------------|
| 1 | Project | name; model = A2F | — |
| 2 | AOI | draw / upload — **any polygon** (A2F needs no rectangle; the AOI step drops the "must be rectangular" warning and offers free-polygon drawing, which `AoiMap` already has as `drawMode='polygon'`) | — |
| 3 | DEM | 3DEP 1/3″ download, upload, or a DEM from the **DEM tool** | `arc_orchestrate.run_arc_dem_all` |
| 4 | Flowline | NHDPlus, GEOGLOWS, or the network from the **Flowline tool** | `run_arc_flowline_for_all_aois` |
| 5 | Streamflow | NWM or GEOGLOWS, one date + hour (snapshot) | `run_arc_flowfile_for_all_aois` |
| 6 | Run | preset: Recommended (falls back to Classic) or Classic | `run_arc_curve2flood_for_all_aois` |
| — | Results | depth map overlay, downloads, which settings ran | — |

Out of v1: duration runs (a map per time step), forecasts, the Joseph-exact
preset, advanced bathymetry knobs. They are one config field each later.

Acceptance: Test Case 3 (Big Sioux, `T2_04`, 2019-09-19 17:00 UTC, NWM) on the
portal gives Parvaneh's map — Recommended fails, Classic maps it, max depth
≈ 6.2 m, ≈ 32 km² wet. Needs the CIROH NWM key (requested).

## How it fits the app

A2F is a fourth wizard built from the existing parts, no new framework:

- **Model:** slug `arc-curve2flood` in `models.py` `MODELS` and `steps.ts`
  `MODELS` (label "ARC-Curve2Flood (A2F)", category flood-mapping,
  runsOnPortal).
- **Step keys:** `adem`, `aflow`, `astream`, `arun`. None start with `t`, so
  the TRITON backfill in `ensure_project_model_column` cannot claim them.
- **Job types:** one `UniformStepJobType` per step in a new
  `job_types/steps_a2f.py`, registered in `REGISTRY`. Each calls the fimcore
  orchestrator with `per_aoi_configs=[cfg]`. The per-AOI
  `workflow_context.json` already carries A2F state between Dask jobs
  (it is persisted with the workspace).
- **Requires:** `aflow` ← `adem`; `astream` ← `aflow`; `arun` ← `astream`.
  Re-running a step supersedes the ones after it (existing graph logic).

## Using prepared inputs (Preparing Input Data → A2F)

### DEM (step 3)
Reuse the Terrain picker (`kind=dem`). fimcore's user-DEM path already clips
and reprojects any DEM to EPSG:4326, which NenCarta needs, so a UTM DEM from
the DEM tool works as is. Backend: the same `prestage_inputs` that sets
`user_dem_path` for LISFLOOD.

### Flowline (step 4) — new `flowline` kind
The Flowline tool exists for A2F (per Parvaneh). It saves two networks:

- `main_river_*` — the one main river, name only, **no stream IDs** → A2F
  cannot use it.
- `all_flowlines_*` — every NHD reach with COMID, Hydroseq, DnHydroseq,
  TotDASqKM → exactly what A2F needs for NWM flows.

Changes:
- `prepared.py`: `flowline` kind → `flowline_tool`; pattern
  `all_flowlines_*.{shp,gpkg}`; list only those.
- If the tool ran with the default settings (main river only), the picker says:
  "Run the Flowline tool again with *Save all flowlines* ticked."
- Copying a **shapefile** copies its side files too (.shx .dbf .prj .cpg), so
  shp and gpkg both work.
- Check on pick: readable vector, lines, has a COMID-type column.
- `aflow` with `source=prepared` → fimcore `source="user"`, which derives
  TOCOMID from Hydroseq and DSContArea from TotDASqKM.

Two rules, because the tool's network is NHD:
- A prepared flowline goes with **NWM** streamflow only. Picking GEOGLOWS in
  step 5 after a prepared flowline is refused at submit with a plain message.
- fimcore fix: today the Streamflow step **rebuilds** the flowline when its
  source doesn't match, which would silently replace the user's pick. Keep a
  user flowline when the streamflow source is NWM (fimcore change + test).

## The NWM key

- Stored once on the server as a Tethys `SecretCustomSetting`
  (`nwm_api_key`, encrypted at rest), never per user, never in the browser.
- The worker gets it as `FIMSIM_NWM_API_KEY` (fimcore `api_keys` already
  reads that) — never in a step config, manifest, log or download.
- NenCarta writes the key into `nencarta.json` and the context file. The run
  step **deletes `nencarta.json` and blanks the key in
  `workflow_context.json`** before the workspace is saved or zipped.
- No key set → the Streamflow step offers GEOGLOWS only and says why.

## Results

`arun.collect` ships the depth and FIM GeoTIFFs from `<AOI>/FloodMaps`, plus
`max_depth_overlay.png` and `overlay_bounds.json` in the same shape LISFLOOD
uses, so the existing Results overlay, stats and zip work unchanged. It also
records which settings ran ("Recommended" or "fell back to Classic").

## Worker environment

Already installed on the dev worker: ARC, curve2flood, nencarta at the pinned
commits, PyQt5, whitebox, geoglows. The job sets `QT_QPA_PLATFORM=offscreen`.
A startup check (fimcore `deps.py`) turns a missing `flood-mapping` CLI into
one clear message. The portal server will need the same install.

## Tickets (each ≤ 16 h; numbers assigned when created on the board)

| Ticket | Hours | What |
|--------|------:|------|
| BE A2F-1 | 10 | Model + step keys + `adem` / `aflow` job types |
| BE A2F-2 | 8 | `flowline` prepared kind (shapefile side files, COMID check, picker hint); fimcore: keep a user flowline with NWM |
| BE A2F-3 | 10 | `astream` job type; NWM key as server secret → worker env; GEOGLOWS-only when no key |
| BE A2F-4 | 12 | `arun` job type: presets + fallback; key scrubbing; collect + overlay; worker env check (NenCarta CLI) |
| BE A2F-5 | 6 | Test Case 3 acceptance on the portal; tests |
| FE A2F-1 | 8 | A2F model in Project creation; AOI step allows any polygon for A2F; steps 3–6 fields |
| FE A2F-2 | 8 | DEM + Flowline pickers, Streamflow and Run fields, fallback notice on Results |
| FE A2F-3 | 3 | Docs page |
| **Total** | **65** | |

Order: BE A2F-1 → 2 → 3 → 4 → FE A2F-1 → 2 → BE A2F-5 → FE A2F-3.
