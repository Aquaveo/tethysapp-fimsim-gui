# FIMsim GUI — Sprint 1 tickets (BYU CIROH format)

---

TASK: BYU CIROH: FIMsim GUI – fimcore Package Extraction + Server-Safety Fixes (FIMSIM-BE1)

Description: Lift the desktop FIMsim repo's `core/` (~13.6k lines, already Qt-free) into a standalone installable package, `fimcore`, that both the desktop app and the Tethys app depend on. The extraction is mostly mechanical; the real work is removing the process-global side effects that are harmless in a single-user desktop process but fatal in a shared Django/Dask worker serving concurrent users. Start as a new repo (or subdirectory package) on our side; restructuring Parvaneh's repo to consume it is negotiated separately and does not block this ticket.

[   ]  `pip install fimcore` (editable) succeeds in a fresh conda env with no PyQt/PySide anywhere in its dependency tree
[   ]  `import fimcore` triggers no network calls, no `os.environ` writes, no `os.chdir`, and does not load the 41 MB HUC8 GeoJSON
[   ]  No module in the package calls `ssl._create_default_https_context = _create_unverified_context` (currently ~7 sites) and no request uses `verify=False` (currently `core/hand.py:176`)
[   ]  `os.chdir` removed from the FIMserv wrapper (`core/FIMserv_api.py:52`); its behavior verified unchanged via the existing CLI entry point (`python -m fimcore.fimserv --aoi … --project … --date …`)
[   ]  GDAL/PROJ tuning applied via `rasterio.Env` context managers scoped to each operation, not process-wide `os.environ` mutation
[   ]  Module-level caches (aoi_info, river_lookup, hand, state_lookup) are bounded (LRU or size-capped) or injected per-call
[   ]  nencarta, PyQt5, gmsh, and h5py absent from package requirements
[   ]  Smoke test passes: DEM prep for the bundled Neuse River test AOI (test_case/AOI_1_Neuse) runs headless to completion via fimcore only
[   ]  Two fimcore functions runnable concurrently in one process (threads) without cross-contamination — regression test included

Implementation Tasks
* Create the fimcore repo/package skeleton (pyproject.toml, src layout, pinned geospatial deps from FIMsim's environment.yml minus GUI/dead packages)
* Move `core/*.py` in as `fimcore/`, fix imports, keep the public function signatures (`per_aoi_configs` dicts + `log_fn`) unchanged
* Sweep and fix the four global-state hazards (SSL, chdir, GDAL env, caches) — grep-verifiable
* Move `data/us_huc8.geojson`, `us_huc6.geojson`, `us_states.geojson` into package data for now (PostGIS migration is FIMSIM-BE3)
* Write the Neuse smoke test + the concurrency regression test (pytest)
* Document the step-function inventory: one table of every orchestrator entry point, its config dict keys, and what files it produces (this becomes the API contract for FIMSIM-BE7)

Out of Scope
* Structured progress events — log_fn stays as-is; conversion happens in FIMSIM-BE5
* Replacing workflow_context.json with Django models (FIMSIM-BE3)
* Unifying the three duplicated orchestrators (orchestrate / triton_orchestrate / arc_orchestrate) — port them as-is; unification is a refactor ticket once tests exist
* Upstream PR to pnikrou/FIMsim to consume fimcore (coordination task, after Parvaneh alignment)
* Any TRITON/ARC/FIMserv web exposure — package them, don't wire them

Notes: The audit found zero tests in the desktop repo, so the smoke + concurrency tests in this ticket are the first safety net. Likely to spawn sub-tickets for stubborn dependencies (e.g., fimserve pins numba==0.60.0, zarr>=3.0.1).

—

TASK: BYU CIROH: FIMsim GUI – Project/AOI/StepRun Data Model + django-storages Wrapper (FIMSIM-BE3 + FIMSIM-BE4)

Description: Replace the desktop app's persistence — an untyped per-AOI `workflow_context.json` key-value bag on local disk — with real Django models in the Tethys app, and route all file artifacts through django-storages so the same code path serves local directories in dev and MinIO/S3 in prod (pattern proven on fimserve per Gio/boss). This is the backbone every endpoint and job ticket builds on.

[   ]  Models exist and migrate cleanly: Project (owner, name, created), AOI (project FK, geometry, working CRS, state/HUC6/HUC8, detected river + gage metadata), StepRun (AOI FK, step key, status, config JSON, output manifest, progress/log)
[   ]  Field coverage validated against the desktop's `_PER_AOI_KEYS` denylist (core/triton_orchestrate.py:34-49) — every key either has a home in the schema or a documented reason it doesn't carry over
[   ]  us_huc8 / us_huc6 / us_states GeoJSON loaded into PostGIS tables with a management command; point-in-polygon HUC8 lookup returns in <100 ms
[   ]  All artifact reads/writes go through the django-storages API; StepRun manifests store storage keys, never absolute paths
[   ]  Keys are isolated per user: <user_id>/<project_id>/<aoi_id>/<step>/…
[   ]  Dev settings run against the local filesystem backend AND against local MinIO with only a settings change — verified both ways
[   ]  A job can stage inputs from storage to a local scratch dir, work, and upload outputs back (helper utilities provided for FIMSIM-BE5)

Implementation Tasks
* Write models + migrations in tethysapp/fimsim_gui (Tethys persistent store / app database per portal convention)
* Management command to load the three reference GeoJSONs into PostGIS (GeoDjango LayerMapping or ogr2ogr)
* storage.py: thin wrapper choosing the django-storages backend from app settings (reuse the MinIO/S3 custom settings already in app.py); helpers stage_inputs(steprun, scratch_dir) / store_outputs(steprun, scratch_dir)
* Unit tests with moto[s3] + one integration test against real local MinIO
* Fallback note: if the CIROH portal's persistent store lacks PostGIS, HUC lookups fall back to fimcore's in-package GeoJSON path (slower, but functional) — implement the switch, document the ask

Out of Scope
* REST endpoints over these models (FIMSIM-BE6/BE7/BE9)
* Quota/retention enforcement (FIMSIM-BE10 — but the byte-counting fields land here)
* Migrating desktop projects into the web app (no import tool)

—

TASK: BYU CIROH: FIMsim GUI – AOI Workflow: Ingest Endpoints + Map UI (FIMSIM-BE6 + FIMSIM-FE2 + FIMSIM-FE3)

Description: The shared entry point of every pipeline: the user creates a project, provides one or more AOIs (upload a zipped shapefile / GeoPackage, or draw a polygon on the map), and the app resolves each AOI's context (working UTM CRS, state, HUC6/HUC8, main river, USGS gages, upstream/downstream endpoints) and shows it on the map. This one implementation replaces the four byte-near-identical ~1,100-line multi-AOI widgets in the desktop app.

[   ]  Project create/list/open endpoints + UI (user sees only their own projects)
[   ]  Upload endpoint accepts zipped .shp and .gpkg; multi-feature files become multiple AOIs (desktop parity with core/multi_aoi.py:inspect_features)
[   ]  Server-side validation rejects: files over the size limit, non-polygon geometry, invalid/self-intersecting rings, AOIs outside CONUS (all data sources are US-only) — each with a specific, actionable error message
[   ]  Draw-a-polygon on the map produces an AOI equivalent to an uploaded one
[   ]  On AOI confirm, a lookup job resolves CRS/state/HUCs/river/gages via fimcore and persists to the AOI record
[   ]  Map displays AOI polygons, detected main river flowline, USGS gage markers, and upstream/downstream endpoints
[   ]  Per-AOI cards list each AOI with its resolved context and per-step status placeholders (populated for real in FIMSIM-FE4+)
[   ]  Works end-to-end with all three bundled test AOIs (Neuse, Village Creek TX, Lumber)

Implementation Tasks
* Backend: upload endpoint (multipart → storage → geopandas validation), AOI CRUD, lookup-job submission + status
* Frontend: MapLibre map component with basemap, upload dropzone, draw control, AOI layer styling
* Frontend: AOI card rail (name, area, state/HUC8, river, gage) with confirm/remove actions
* Wire the AOI-area precheck hook (actual cap enforcement lands in FIMSIM-BE10 — leave the interface in place)
* Reuse FIMeval GUI's upload + presigned-URL patterns where they fit

Out of Scope
* Step configuration panels (FIMSIM-FE4/FE5/FE6)
* AOI editing after confirmation (delete + re-add only for MVP)
* Non-CONUS support
* Shapefile repair/fix-up tooling — invalid geometry is rejected, not repaired

—

TASK: BYU CIROH: FIMsim GUI – DaskJob Wiring + DEM Step End-to-End (FIMSIM-BE5 + DEM slice of FIMSIM-BE7/FE4)

Description: Prove the entire execution path — submit → Dask worker → fimcore → storage → progress → result on the map — using the simplest real step: DEM acquisition (USGS 3DEP 1/3″ or TACC HAND; GeoTIFF/ASCII output). Everything here (job type registry, structured progress, scratch-dir staging, cancellation) becomes the template that makes the remaining steps (Manning, BCI, BDY, PAR) mostly configuration. Per meeting alignment (Gio owns cluster orchestration design), jobs run on Tethys DaskJob with one job per AOI, fanned out — replacing the desktop's sequential for-loop over AOIs.

[   ]  Pluggable job type registry (FIMeval GUI pattern) with a DEMStep job type registered
[   ]  Submitting the DEM step for a 2-AOI project creates two DaskJobs that run concurrently on the local dask scheduler + worker
[   ]  fimcore's log_fn markers (e.g. "▶ DEM [i/n]") are converted by the job wrapper into structured progress events persisted on StepRun — the browser polls status, never parses log strings
[   ]  Staged statuses visible in the UI: queued → downloading → processing → uploading → complete (or error, with the failure message surfaced)
[   ]  Outputs uploaded to storage on completion; manifest recorded; download button works
[   ]  Completed DEM renders as a map overlay on the AOI
[   ]  Cancel button stops a running job (cancel flag checked inside log_fn — the desktop's WorkerCancelled pattern) and marks the StepRun cancelled
[   ]  End-to-end demo: Neuse test AOI → 10 m 3DEP DEM → overlay + download, on a laptop, no cloud resources

Implementation Tasks
* Job wrapper: stage inputs from storage → scratch dir, call the fimcore step function with an injected log_fn adapter, upload outputs, finalize StepRun
* log_fn adapter: translate the marker conventions (audit found them consistent across orchestrators) into (stage, current, total, message) events; unknown lines append to a plain log field
* Submit/status/cancel endpoints keyed on StepRun; per-AOI fan-out on submit
* Frontend DEM panel: source (3DEP/HAND), resolution, format; progress display on the AOI cards; result overlay (COG → PNG bounds overlay for MVP)
* Dev docs: run local dask scheduler + worker alongside tethys manage start

Out of Scope
* The other four wizard steps (rest of FIMSIM-BE7 — they clone this template)
* LISFLOOD-FP execution (FIMSIM-BE8)
* Websocket push — polling is fine for MVP
* Optimizing single-download speed (fimserve/OWP concurrency spike is the v3 roadmap item)
* Dask cluster productionization / Karpenter (Gio, post-local-MVP per Nathan)

Notes: First ticket that exercises fimcore under a Dask worker — expect to catch any global-state stragglers FIMSIM-BE1 missed. Budget time for that.

—

TASK: BYU CIROH: FIMsim GUI – Resource Guards + Output Packaging (FIMSIM-BE9 + FIMSIM-BE10)

Description: The desktop app has no limits at all — the audit flagged unbounded AOI-area × resolution as the #1 public-portal risk (a large AOI at 1 m resolution means a multi-gigapixel in-RAM raster), and the FIMecosystem meeting explicitly aligned on capping input shapefile area for system stability. This ticket adds the guard rails plus the download-packaging endpoints that preserve the desktop's take-these-files-to-your-solver behavior.

[   ]  Pre-submission dimension check: predicted raster size (AOI bbox ÷ cell size) computed before any job is created; over-cap requests rejected with a message stating the predicted size, the cap, and what to change (smaller AOI or coarser resolution)
[   ]  Caps on AOIs per project and concurrent running jobs per user (configurable app settings)
[   ]  Per-user storage usage tracked and visible; submissions blocked over quota with a clear message
[   ]  Retention policy: artifacts older than the configured window are cleaned up (generous default until policy is decided); cleanup is logged and idempotent
[   ]  Download endpoints: per-step zip and whole-project zip, streamed (not buffered in RAM), correct filenames
[   ]  Job timeouts enforced; a timed-out job marks the StepRun failed with a user-visible reason
[   ]  fimcore's broad `except Exception: pass` sites (aoi_info, arc_run, dem) replaced with logged warnings — server-side failures are never silent

Implementation Tasks
* Dimension/area precheck utility + enforcement in the submit endpoint (wire into the hook left by the AOI ticket)
* Per-user usage accounting on the storage wrapper (bytes written/deleted per key prefix)
* Retention cleanup as a periodic job/management command
* Zip-streaming download endpoints with per-user authorization checks
* Timeout wrapper on the DaskJob wrapper from FIMSIM-BE5
* Load-check: submit at the concurrent-jobs cap and at the cap+1 boundary; verify rejection UX and server health

Out of Scope
* Full security audit / load-testing battery (separate Testing & Hardening ticket, FIMeval-style)
* Billing/accounting beyond byte counts
* Admin UI for adjusting caps (app settings + Django admin is enough for MVP)

Notes: Cap values need a team decision (meeting decided THAT a cap exists, not its value). Recommend deriving from a worker-RAM budget: e.g., max predicted raster ≈ 500M cells ≈ 2 GB float32, then halve it. File the chosen values in this ticket when set.
