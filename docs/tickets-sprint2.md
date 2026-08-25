# FIMsim GUI — Sprint 2 tickets (BE3–BE5, individual)

Supersedes the combined BE3+BE4 and BE5 drafts in `tickets-sprint1.md`.

---

TASK: BYU CIROH: FIMsim GUI – Project/AOI/StepRun Data Model + PostGIS Lookups (FIMSIM-BE3)

Description: Replace the desktop app's persistence — an untyped per-AOI `workflow_context.json` key-value bag on local disk — with real Django models in the Tethys app's persistent store. This is the backbone every endpoint and job ticket builds on: projects and AOIs become queryable per-user records, step execution becomes an auditable StepRun row, and the 41 MB bundled HUC8 GeoJSON becomes an indexed PostGIS table instead of an in-memory GeoDataFrame per worker.

[   ]  Persistent store declared (PersistentStoreDatabaseSetting, spatial=True) and models migrate cleanly on tethys install
[   ]  Project: owner (portal user), name (sanitized like fimcore's clean_name), created/updated timestamps; unique (owner, name)
[   ]  AOI: project FK, geometry (WGS84 polygon), name, source (upload/drawn/example), working CRS EPSG, resolved state(s), HUC6/HUC8 codes, detected main-river name, gage metadata JSON, area km², is_rectangular
[   ]  StepRun: AOI FK, step key (dem/manning/bci/bdy/par/run), status (pending/queued/running/succeeded/failed/cancelled), config JSON (the per_aoi_configs dict), output manifest JSON (storage keys, not paths), progress JSON, log text, started/finished timestamps, bytes_written (BE10 feeds off this)
[   ]  Field coverage validated against fimcore's _PER_AOI_KEYS denylist (triton_orchestrate.py:34-49) — every key has a schema home or a documented reason it doesn't carry over
[   ]  Management command loads us_huc8/us_huc6/us_states GeoJSONs into PostGIS with spatial indexes; point-in-polygon HUC8 lookup < 100 ms
[   ]  Lookup helper with fallback: if the portal's persistent store lacks PostGIS, fall back to fimcore's in-package GeoJSON path (slower but functional) — switch is a setting, the ask is documented
[   ]  Unit tests: model constraints, per-user scoping, the _PER_AOI_KEYS coverage check as an executable test

Implementation Tasks
* Declare the spatial persistent store in app.py; models + migrations under tethysapp/fimsim_gui/models.py
* Loader command (GeoDjango LayerMapping or ogr2ogr) + idempotent re-run behavior
* huc_lookup(point_or_geom) helper with the PostGIS/fimcore fallback switch
* Serializer-ready to_dict()s for Project/AOI/StepRun (consumed by BE6/BE7 endpoints)

Out of Scope
* REST endpoints (FIMSIM-BE6/BE7/BE9) · storage wrapper (FIMSIM-BE4) · quota/retention enforcement (FIMSIM-BE10) · desktop-project import tool

Notes: Whether the CIROH portal's persistent store has PostGIS is design-brief decision #3 (still open with the team) — build against PostGIS locally, keep the fallback honest.

—

TASK: BYU CIROH: FIMsim GUI – django-storages Wrapper + Per-User Key Isolation (FIMSIM-BE4)

Description: One code path for files everywhere (boss directive, pattern proven on fimserve): local filesystem backend in dev, MinIO/AWS S3 in the cloud, selected purely by settings. All artifact reads/writes go through this wrapper; StepRun manifests store storage keys, never absolute paths. The app's MinIO custom settings (endpoint, keys, bucket, browser-facing public endpoint) are already populated in the portal admin.

[   ]  storage.py builds the django-storages backend from the app's custom settings; blank endpoint = real AWS; a dev settings toggle selects the local filesystem backend instead
[   ]  Key scheme enforced: <user_id>/<project_id>/<aoi_id>/<step>/<filename> — helpers construct keys, nothing hand-assembles them
[   ]  stage_inputs(steprun, scratch_dir) pulls a StepRun's input artifacts from storage into a local scratch dir; store_outputs(steprun, scratch_dir) uploads produced files, records keys + sizes in the manifest, and increments bytes_written
[   ]  Presigned URLs for browser download (and upload, for BE6) honoring the s3_public_endpoint_url setting when the browser reaches storage at a different host than the server
[   ]  A user can never construct or receive a key outside their own <user_id>/ prefix — covered by tests
[   ]  Unit tests with moto[s3]; one integration test against the real local MinIO (fimeval precedent: moto alone missed real-MinIO behaviors)
[   ]  Verified both ways in dev with only a settings change: local dirs ↔ MinIO

Implementation Tasks
* storage.py wrapper + key helpers; reuse FIMeval GUI's storage.py/presign patterns where they fit
* Wire manifest read/write onto BE3's StepRun
* moto test suite + live-MinIO integration test (skipped when MinIO is down)

Out of Scope
* Upload endpoint itself (FIMSIM-BE6) · quota enforcement (FIMSIM-BE10 — but bytes accounting lands here) · retention/cleanup (BE10)

—

TASK: BYU CIROH: FIMsim GUI – Job Type Registry + DaskJob Wiring + Structured Progress (FIMSIM-BE5)

Description: The execution backbone: a pluggable job-type registry (FIMeval GUI pattern) running fimcore step functions on Tethys DaskJob via the dask_primary scheduler, with one job per AOI (fan-out — replacing the desktop's sequential for-loop). The wrapper stages inputs from storage to a scratch dir, calls the fimcore function with an injected log_fn adapter that converts the engine's log markers (`▶ DEM [i/n]`, `✓ …`) into structured progress events persisted on StepRun, uploads outputs, and finalizes status. The browser will poll status — it never parses log strings. Validated with the DEM step function as the guinea pig, driven by a management command / test harness (REST endpoints are BE6/BE7; UI is FE4+).

[   ]  PREREQUISITE cleared: the portal tethys env's broken pyproj (transforms return inf) is fixed and fimcore installs + passes its offline tests inside that env
[   ]  Job type registry: job types declare (step key, fimcore callable, config schema); registering a new step is data, not plumbing
[   ]  DaskJob submission via the dask_primary scheduler setting; dev docs cover running dask scheduler + dask worker alongside tethys manage start
[   ]  Submitting the DEM step for a 2-AOI project creates two DaskJobs that run concurrently on the local scheduler; StepRuns track each independently
[   ]  log_fn adapter parses the marker conventions into (stage, current, total, message) events persisted on StepRun.progress; unrecognized lines append to StepRun.log; nothing downstream regex-parses logs
[   ]  Staged statuses recorded: queued → running (downloading/processing sub-stages from markers) → uploading → succeeded / failed (failure message surfaced, never silent)
[   ]  Cancellation: a cancel flag checked inside the injected log_fn raises WorkerCancelled (the desktop's cooperative-cancel pattern); StepRun marked cancelled, scratch cleaned up
[   ]  Job timeout enforced by the wrapper; timed-out runs marked failed with a user-visible reason
[   ]  End-to-end proof on a laptop, no cloud resources: Neuse test AOI → DEM job through the full stage→run→upload→manifest path with live progress rows

Implementation Tasks
* Fix the tethys env PROJ issue (likely PROJ_LIB/proj.db path or conda solver damage; compare against fimtest env), then pip install -e fimcore into it
* job wrapper module: stage (BE4 helpers) → run with log adapter → store_outputs → finalize
* Marker parser: table of known patterns from fimcore's orchestrators (▶/✓/✗ STEP [i/n], "Download progress: i/n") with graceful passthrough for the rest
* Registry + DEMStep registration; management command submit_step for harness testing
* Coordinate with Giovanni's cluster-orchestration design so nothing here assumes a single-machine scheduler

Out of Scope
* REST endpoints (BE6/BE7) · frontend progress UI (FE7) · the other four wizard steps' job types (BE7 — they clone the DEM registration) · websocket push (polling first) · Dask cluster productionization / Karpenter (Gio, post-local-MVP)

Notes: First ticket that runs fimcore under a Dask worker — expect to catch any global-state stragglers BE1's tests missed; budget time for that.
