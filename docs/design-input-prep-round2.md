# Preparing Input Data, round 2: use prepared inputs inside Flood Modeling — design (2026-10-27)

Status: approved in conversation by Reshma Raghavan on 2026-10-27. Board task
group: WP 23586 ("Preparing Input Data, Round 2: Use Prep Outputs Inside Flood
Modeling"); tickets BE20+ / FE71+ are filed from this spec. Round 1:
`docs/design-input-prep.md` (decision 2 deferred reuse to this round).

## Purpose

At the 2026-10-22 demo the group asked for a seamless connection between the
two categories: a DEM, a Manning's n grid or a streamflow series made with a
Preparing Input Data tool should be usable inside a Flood Modeling project
without downloading it and uploading it again.

Success: on the Lumber River (Test Case 3), run the DEM tool, the LULC &
Manning tool and the Streamflow Data tool; then, in a LISFLOOD-FP project on the
same river, pick those three outputs in Terrain, Roughness and Flow Data, run
the model, and get a flood map. The same three picks work in a TRITON project
and produce a deck.

## Decisions (Reshma, 2026-10-27)

1. **List all of the user's tool runs, with a coverage check.** A modeling
   project and a tool project each have their own drawn area, so "the same
   area" cannot be matched by identity. The picker lists every succeeded tool
   run of the right kind from any of the user's projects, flags the ones whose
   file does not cover this AOI, and the server refuses an uncovered pick.
2. **Copy, don't link.** Picking copies the file into the modeling AOI's own
   storage prefix. The modeling project then never depends on the tool project
   (deleting it, or re-running the tool, which overwrites its outputs under
   the same keys, changes nothing here).
3. **GeoTIFF and CSV only.** Only files the engine reads directly are
   offered: `.tif` rasters and the Streamflow tool's `time_hours,
   discharge_cms` CSVs. A run exported only as ASCII grid or GeoPackage shows
   in the list as not usable, with "re-run the tool with GeoTIFF".
4. **Flowlines are out of scope.** The Boundaries step downloads the same NHD
   lines itself and the reach ID is already prefilled; reusing the Flowline
   tool's files adds nothing yet.
5. **The FE67 notice is softened** once this ships: the categories stay
   independent, and anything prepared can be picked inside a modeling step.

## What the engine already does (no fimcore change)

| Input | LISFLOOD-FP | TRITON | Web app today |
|---|---|---|---|
| DEM file | `run_lisflood_dem_all(has_dem, user_dem_path)` | `run_triton_dem_all(user_dem_path)` | Wired (BE17 upload → `user_dem_keys`) |
| Manning's n raster | `prepare_manning(have_manning_raster, manning_src_path)` | `prepare_triton_manning(lulc_source="user_manning", user_manning_path)` | Not wired |
| Land-cover raster | `prepare_manning(have_lulc, lulc_src_path)` + the step's class table | `prepare_triton_manning(lulc_source="user_lulc", user_lulc_path)` + `lulc_class_to_n` | Not wired |
| Discharge CSV | `create_bdy(bdy_source="csv", user_csv_path)` via per-AOI `file_path` | `run_triton_hydro_for_all_aois` (`bdy_source="csv"`, `file_path`) | Not wired |

Every supplied raster is reprojected and resampled onto the step's DEM grid and
masked to the AOI by the engine, so a prepared file at another cell size or CRS
is fine. A discharge CSV carries its own dates; the step's event window is not
used for it.

## Architecture

**One storage hook per input, shared by upload and pick.** Each modeling job
type gets a `user_<kind>_keys` config key (the BE17 pattern): `user_dem_keys`
(exists), `user_manning_keys`, `user_lulc_keys`, `user_flow_keys`. The keys are
storage keys under the AOI's own prefix (`<user>/<project>/<aoi>/user_<kind>/…`).
`prestage_inputs` downloads them into the AOI folder and sets the server-only
path the engine reads (`user_dem_path`, `manning_src_path` / `lulc_src_path`,
`file_path`). `api_step_submit` rejects keys outside this AOI's prefix, as it
does for DEMs today (`rejected_dem_keys`, generalized). Because the hook takes
storage keys, a later "upload your own Manning raster / flow CSV" needs only an
upload endpoint, not new job code.

**Listing prepared inputs.** `GET /api/aois/{aoi_id}/prepared?kind=dem|manning|lulc|flow`
returns the requesting user's succeeded tool runs of the matching step
(`dem_tool` → dem; `lulc_tool` → manning and lulc; `flow_tool` → flow), newest
first, one row per usable file:

```json
{"prepared": [{
  "steprun_id": 812, "project": "Lumber prep", "aoi": "AOI_3_Lumber",
  "file": "ManningN_AOI_3_Lumber.tif", "finished": "2026-10-27T15:02:11Z",
  "detail": "NLCD 2021 · 30 m", "covers": true, "usable": true, "reason": null
}]}
```

`covers` compares the file's footprint with the modeling AOI's bounds, both in
EPSG:4326 (rasters: the raster bounds; CSVs: always true, a flow series has no
footprint). `usable` is false for a non-GeoTIFF raster run, with `reason`.
Footprints are read from the stored file's header on request (rasterio over the
storage path / a presigned URL), not cached, so there is no new table.

**Picking.** `POST /api/aois/{aoi_id}/prepared` with `{steprun_id, file, kind}`:
checks the run belongs to the user and succeeded, the file is in its manifest
and of the right kind, the raster passes `validate_dem_geotiff` (renamed
`validate_geotiff`, same checks) and covers the AOI; then copies the object to
`build_key(user, project, aoi, f"user_{kind}", file)` and returns
`{key, name, bytes, source: {steprun_id, project, aoi}}`, the same shape as the
DEM upload response. The step stores the key in its config like an upload.

**Frontend: one picker, three steps.** A `PreparedPicker` component (list,
coverage badge, unusable rows greyed with their reason, "Use this" button) is
shown when the step's input choice is "Use a prepared input":

- Terrain (`dem`, `tdem`): `dem_input` gains `prepared` next to `download` and
  `upload`; the pick fills `user_dem_keys`.
- Roughness (`manning`, `tfric`): a new `manning_input` choice (`download`,
  `prepared`). From an LULC & Manning run the user picks either its Manning's n
  grid (the class table is hidden: values come from the file) or its land
  cover (the class table stays and is applied).
- Flow Data (`bdy`, `thyg`): `bdy_source` gains `prepared`; the pick fills
  `user_flow_keys`, and the window, interval and gage fields are hidden (the
  CSV carries its own dates; the hydrograph preview plots it as usual).

The step summary and the Results inputs tab name the source ("Prepared:
ManningN_AOI_3_Lumber.tif from Lumber prep"). The pick is copied, so the
summary needs no live link to the tool project.

## Error handling

- Pick of a file that does not cover the AOI → 400 "the prepared file does not
  cover this area — re-run the tool on an area that contains it".
- Tool run deleted between listing and pick → 404 "that prepared run no longer
  exists"; the picker refreshes.
- A Manning grid with values outside the hard band 0.01–0.15 → the engine's
  existing `_check_manning_values` warnings appear in the step log; the
  Manning warning flags (FE52) are not applied to a file pick (there is no
  table).
- A CSV the engine cannot read → the step fails with fimcore's message, as for
  any engine error (FE49 failure detail).

## Testing

Backend (pytest): listing filters by user, step and status; `covers` true,
false and CSV; unusable formats; pick copies to the AOI prefix and refuses
foreign runs, non-manifest files, uncovered rasters; each job type's
`prestage_inputs` turns `user_<kind>_keys` into the engine argument;
submit rejects foreign keys. Frontend (vitest): picker row states; each step's
field visibility per input choice; config carries the right key. Acceptance:
the Lumber River flow in Success, on LISFLOOD-FP and TRITON.

## Tickets (hours)

| Ticket | Hours |
|---|---|
| BE: list prepared inputs, with the coverage check | 6 |
| BE: pick = copy a prepared file into the AOI prefix (shares the GeoTIFF validator) | 6 |
| BE: Roughness takes `user_manning_keys` / `user_lulc_keys` (LISFLOOD-FP and TRITON) | 8 |
| BE: Flow Data takes `user_flow_keys` as a CSV source (LISFLOOD-FP and TRITON) | 8 |
| FE: `PreparedPicker` component | 8 |
| FE: wire the picker into Terrain, Roughness and Flow Data, plus docs | 8 |
| FE: soften the FE67 notice | 1 |
| **Total** | **45** |

Order: the two listing/pick endpoints first, then the Roughness and Flow Data
hooks, then the picker and its wiring, the notice last.
