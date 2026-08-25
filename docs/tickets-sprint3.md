# FIMsim GUI — Sprint 3 tickets (BE6–BE8, individual)

---

TASK: BYU CIROH: FIMsim GUI – AOI Ingest Endpoints: Upload, Validate, Lookups (FIMSIM-BE6)

Description: The REST layer that makes projects and AOIs real: project CRUD, AOI upload/draw ingestion with server-side validation, and the context lookups (working CRS, state, HUC6/HUC8, main river, USGS gages) that power the AOI cards and map display. Replaces FE2's client-side-only parsing: the server becomes the source of truth, which also unlocks GeoPackage support (pyogrio reads .gpkg natively — the browser couldn't) and closes FE2/FE3's remaining gaps. Follows the FIMeval GUI endpoint idiom: login-required controllers returning JSON, presigned direct-to-storage upload.

[   ]  Project endpoints: create (name-sanitized, unique per user), list (own projects only), retrieve, delete; all login-required, all scoped to request.user
[   ]  AOI upload flow per the house pattern: presign → browser PUTs the file to storage → ingest endpoint validates and creates AOI rows (small files may use direct multipart POST — pick one and document why)
[   ]  Accepted formats server-side: zipped shapefile, GeoPackage, GeoJSON — every polygonal feature becomes its own AOI (fimcore inspect_features parity); non-polygon features reported, not silently dropped
[   ]  Validation with specific, actionable errors: file size cap, zip-slip-safe extraction, valid/non-self-intersecting rings, CONUS bounds, rectangularity flag (matching the FE11 corner-angle rule) — invalid geometry is rejected, not repaired
[   ]  Draw-created AOIs: POST GeoJSON ring → same validation → AOI row
[   ]  Lookup execution: CRS/state/HUC via BE3's PostGIS synchronously (<1 s); river + gage detection (network NHD calls, seconds–minutes) runs as a BE5 background job with polled status — the AOI card shows "resolving…" until done
[   ]  Results persisted onto the AOI row (BE3 fields); repeat opens hit the DB, not the network
[   ]  Endpoint tests: auth scoping (user A cannot see/ingest into user B's project), each validation rejection, multi-feature fan-out, gpkg + zip + geojson happy paths (use the three bundled FIMsim test AOIs)

Implementation Tasks
* Controllers: api/projects, api/projects/<id>/aois (+ presign, ingest, delete), api/aois/<id>/lookup-status
* Server-side inspect: geopandas/pyogrio read from staged file → per-feature AOI rows with area/CRS/rectangularity
* Lookup job type registered on BE5's registry wrapping fimcore's aoi_info/river_lookup calls
* FE wiring: swap AoiStep from client-side shpjs parsing to the upload endpoints; surface lookup results (river/gages) on cards + map — completes FIMSIM-FE2/FE3
* CSRF cookie endpoint per the family pattern

Out of Scope
* Step submission endpoints (FIMSIM-BE7) · AOI area×resolution cap enforcement (FIMSIM-BE10 — but the precheck hook stays in place) · shapefile repair · non-CONUS support

—

TASK: BYU CIROH: FIMsim GUI – Wizard Step Job Endpoints: DEM / Manning / BCI / BDY / PAR (FIMSIM-BE7)

Description: Expose the five LISFLOOD-FP data-prep steps as submittable jobs. BE5 proved the pattern with DEM; this ticket formalizes the config contracts and clones the registration for the remaining four steps. The per-step config dicts (`per_aoi_configs`) documented in fimcore's `docs/step-functions.md` become validated serializers — the desktop built these dicts from Qt widget state; the web builds them from request JSON.

[   ]  Uniform endpoint set per step: GET defaults/schema, POST submit (project-wide, fans out one BE5 job per AOI, honoring per-AOI config overrides), GET status (all AOIs' StepRuns for the step), POST cancel
[   ]  Config serializers per step, validated before any job is created; validation errors name the field and the fix
[   ]  DEM: source (3DEP/HAND), resolution, output format, optional user-DEM key (uploaded via BE6's presign path)
[   ]  Manning: LULC source (NLCD year / Sentinel-2), editable Manning table round-trip — GET returns the computed per-class table (min/avg/max), POST accepts the user-edited table before rasterization (desktop manning_table parity)
[   ]  BCI: upstream/downstream boundary options driven by the AOI's detected river endpoints (BE6 lookups); produces .bci + flowlines
[   ]  BDY: flow-data source — NWM retrospective (date range), NWM forecast (range/date/hour), USGS gage, user CSV/XLSX (uploaded), or premade .bdy passthrough; returns the hydrograph series for FE5's preview chart
[   ]  PAR: solver knobs (mode, timestep, saveint, SGC, checkpoint, extra keywords) with the desktop defaults; produces model.par
[   ]  Step-dependency guards: a step whose inputs are missing (e.g. BDY before BCI's river detection) is rejected with a message naming the prerequisite step
[   ]  Re-run semantics: resubmitting a step creates a new StepRun, supersedes the old manifest, and invalidates downstream steps' "current" status
[   ]  Tests per step: schema validation, dependency guard, fan-out count, config→fimcore-kwargs mapping (mock the fimcore call for speed; one live marker-parse test per step reusing BE5's harness)

Implementation Tasks
* Formalize the config schema per step from fimcore's create_par/create_bdy/create_bci/manning/dem signatures (the step-functions inventory is the map)
* Register four new job types on the BE5 registry (DEM already exists)
* Manning-table computation endpoint (fimcore's LULC stats path, run as a short job)
* Hydrograph-preview data endpoint (reads the produced *_strmflow_timeseries.csv from storage)
* FE contract notes for FE4/FE5/FE6 (field lists, defaults, units)

Out of Scope
* The Run step (FIMSIM-BE8) · results/download endpoints (FIMSIM-BE9) · TRITON/ARC/HAND-FIM step endpoints (post-MVP; same pattern) · frontend panels (FE4–FE6)

—

TASK: BYU CIROH: FIMsim GUI – LISFLOOD-FP Solver Build + Run Job Type (FIMSIM-BE8)

Description: The genuinely new engineering in the MVP — the desktop app stops at writing the input deck; the web app runs the simulation (meeting alignment: LISFLOOD-FP prioritized because it runs on standard CPUs). Obtain and build the open-source LISFLOOD-FP solver, wrap it as a BE5 job type that runs the generated deck as a subprocess, and post-process the raw outputs into a displayable flood map. Highest-uncertainty ticket: no desktop code exists to port, and solver runtime/output behavior must be characterized empirically.

[   ]  Solver sourcing settled and documented: LISFLOOD-FP 8.x open-source release (University of Bristol), CPU build via CMake; license terms verified for hosted use and recorded in the repo (Parvaneh confirmed in the Aug meeting that the models used are open-source — verify the specific license text anyway)
[   ]  Reproducible build: a build script (and/or conda-forge/container recipe) producing the executable on Linux x86_64; version pinned; binary location configurable via app setting — the binary is NOT committed to git
[   ]  Run job type on the BE5 registry: stages the AOI's lisflood-files deck (dem.ascii, lulc.ascii, .bci, .bdy, model.par) to scratch, runs the solver as a subprocess with wall-clock timeout, captured stdout/stderr, and a cancel that terminates the process tree
[   ]  Progress: solver output parsed for simulation-time advancement (t= / mass-balance lines) → structured progress events (percent of sim duration), same StepRun contract as every other step
[   ]  Post-processing: max-depth output (.max) + final water depth converted from LISFLOOD's ASCII grids to compressed GeoTIFF in the AOI's working CRS; wet/dry binary raster derived; all uploaded to storage and recorded in the manifest
[   ]  Non-zero exit / solver instability (NaN blow-up, mass-balance explosion) surfaces as a failed StepRun with the tail of the solver log attached — never silent
[   ]  Acceptance run: the Neuse River Hurricane Matthew test case (deck generated by BE7 steps at coarse resolution) runs to completion on a laptop and produces a plausible flood-extent GeoTIFF
[   ]  Resource ceilings enforced: CPU-thread cap and scratch-disk budget per job (coordinates with BE10's caps; solver runs must not starve the data-prep workers)

Implementation Tasks
* Build LISFLOOD-FP from source; record exact commit/version + build flags; test the executable against the deck FIMsim's test_case docs describe
* Characterize runtime vs. grid size / sim duration on the Neuse case → informs BE10's cap values and the job timeout default
* Subprocess wrapper (process-group kill for cancel, timeout, streamed stdout parsing) as a variant of the BE5 wrapper (fimcore-call jobs vs. subprocess jobs)
* ASCII→GeoTIFF post-processor (rasterio; CRS/transform from the deck's dem.ascii header)
* Deployment note for the portal: where the binary lives in prod (conda package vs. container layer vs. baked into the worker image) — decide with Gio's cluster design

Out of Scope
* TRITON execution (GPU — post-MVP, pending permissions/hardware) · remote/HPC execution (the BE5 scheduler abstraction is the seam) · solver-parameter auto-tuning/calibration · time-series animation outputs (FIM database / FIMeval integration discussions pending)

Notes: Two known unknowns to resolve early: (1) exact output-file set the .par options produce (depends on saveint/overpass flags BE7 exposes); (2) whether the deck fimcore writes runs unmodified on LISFLOOD-FP 8.x or targets an older solver version — Parvaneh will know. Recommend a half-day spike on both before committing the ticket to a sprint.
