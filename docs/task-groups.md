# FIMsim GUI — Task Groups (BYU CIROH format)

---

TASK GROUP: BYU CIROH: FIMsim GUI Web Application

Build a multi-user web application that lets users set up and run 2D flood inundation simulations entirely through a browser — no local Python environment, GIS stack, or model installation required. Users define a project and an Area of Interest (upload a shapefile/GeoPackage or draw on a map); FIMsim downloads and processes every required input (DEM, land cover / Manning's n, flowlines, streamflow), writes all model configuration files, and — new relative to the desktop app — submits the simulation to the compute backend and displays the resulting flood map. The MVP is the LISFLOOD-FP pipeline end-to-end including server-side execution (runs on standard CPUs, per FIMecosystem meeting alignment); TRITON (needs GPU + permissions), OWP HAND-FIM, and ARC-Curve2Flood follow as post-MVP modules.

The app is built on Tethys 4 (Django backend) with a React/TypeScript frontend served as a Single-Page Application — same architecture as FIMeval GUI. Async job execution uses Tethys's built-in DaskJob framework backed by a Dask Distributed cluster (one job per AOI, fanned out for multi-AOI projects). Files (inputs, outputs) are handled through django-storages: local directories in dev, S3-compatible object store (MinIO dev / AWS S3 prod) in the cloud — one code path. The simulation/data-prep engine is not rewritten: the desktop FIMsim repo's Qt-free `core/` (~13.6k lines) is extracted into a shared `fimcore` package consumed by both the desktop app and this web app. MVP is built and run locally first; AWS infrastructure is requested only after the local MVP works (per Nathan). FIMsim stays a separate app within the CIROH portal (per Nathan).
_____________________________________________________________________________________________

🏁  Completed

✅ Full code audit of FIMsim v1.1 desktop app (modes, data sources, dependencies, core/gui coupling) ✅ Design brief with architecture options + phasing (shared-core option endorsed) ✅ Key audit finding: `core/` has zero Qt imports and is directly reusable as the backend engine ✅ Decisions aligned in FIMecosystem meeting: LISFLOOD-FP prioritized for MVP (CPU), TRITON deferred (GPU + permissions), AOI/shapefile area cap, build locally before requesting AWS, apps kept separate in the portal
_ _ _
⏳  In Progress

* (nothing yet — groups below are ready to start)
_ _ _
🔜  To Do

Backend (see FIMsim-BE group)
* Extract `fimcore` package from desktop `core/` + fix server-unsafe globals (SSL bypass, os.chdir, global GDAL env, unbounded caches)
* Tethys 4 + React/Vite scaffold, Project/AOI/StepRun data model (replaces per-AOI workflow_context.json), HUC8/HUC6/states lookups into PostGIS
* django-storages wrapper (local dirs dev → MinIO/S3 prod), per-user key isolation (<user_id>/<project_id>/<aoi_id>)
* Pluggable job type registry + DaskJob wiring; log_fn → structured progress events (replaces desktop's log-regex parsing)
* AOI ingest endpoints: upload/draw, validation, CRS pick, state/HUC/river/gage lookups
* Wizard step job endpoints: DEM, Manning/LULC, BCI, BDY, PAR (thin wrappers over fimcore step functions)
* LISFLOOD-FP solver: build/containerize the executable, run-simulation job type, result post-processing (max-depth raster → displayable overlay)
* Outputs/download endpoints (per-step and whole-project zip)
* Resource guards: AOI area × resolution cap (pre-submission dimension check), per-user quotas, retention/cleanup

Frontend (see FIMsim-FE group)
* App shell + wizard layout (Project → AOI → DEM → Manning → BCI → BDY → PAR → Run → Results)
* AOI step: map with shapefile/GeoPackage upload and draw-a-polygon, per-AOI cards, detected river/gages display
* Step config panels incl. editable Manning's n table and hydrograph preview chart
* Running step: staged progress per AOI (queued → downloading → processing → simulating → complete)
* Results page: flood-map overlay on the map + metrics/outputs table + download buttons
* Job/project history list
* Production Vite build integrated into the Tethys app template

Testing & Hardening
* Integration tests against real MinIO (not just moto); end-to-end test with the Neuse River test AOI (Hurricane Matthew, from FIMsim's test_case/)
* Load test: concurrent AOI jobs against the Dask cluster; concurrent NWM/3DEP downloads (external service rate-limit behavior)
* Security audit: upload validation (zip-slip, malformed shapefiles), per-user S3 key isolation, presigned URL expiry, DoS via oversized AOIs
_____________________________________________________________________________________________

🚏  Future Modules (Post-MVP Roadmap)

* v2: TRITON pipeline + server-side GPU execution (blocked on GPU permissions; Karpenter-on-AWS GPU node provisioning — Giovanni's investigation)
* v3: OWP HAND-FIM pipeline via fimserve — includes the concurrency spike: fork fimserve + OWP inundation-mapping, prototype concurrent HUC8 downloads / parallel Zarr reads, upstream PRs if wins are real
* v4: ARC-Curve2Flood pipeline (pure Python, runs in-process)
* v5: Standalone input-prep tools as lightweight pages (DEM / LULC+Manning / Flowlines / Streamflow — desktop Track-A parity)
* v6: Multi-AOI batch at scale (parallel AOI fan-out UX, project-level dashboards)
* v7: Interactive COG raster results with MapLibre overlay + time-series animation of flood extent

---

TASK GROUP: BYU CIROH: FIMsim-BE – Backend API

🎯 Goal: A secure, tested REST API and job-execution layer covering the full LISFLOOD-FP lifecycle — project/AOI setup, per-step data-prep jobs, server-side simulation, and result retrieval — so the React frontend has a complete backend to work against and the desktop app gains a shared engine package.

🔧 Done so far: Tethys 4 app scaffolded and pushed to github.com/Aquaveo/tethysapp-fimsim-gui (private) — catch-all home controller, MinIO/S3 custom settings, dask_primary scheduler setting, django-storages baseline dependencies, fimeval-gui house conventions.

🛠️ What will be done: The desktop repo's `core/` will be extracted into an installable `fimcore` package with its server-unsafe globals fixed. The scaffolded Tethys 4 app gains Project/AOI/StepRun models, django-storages file handling, and a pluggable job type registry on DaskJob. REST endpoints will cover AOI ingest (upload → validate → lookups), each wizard step as a submittable job with structured progress, LISFLOOD-FP execution, and output listing/download. Resource guards (AOI area cap, quotas, retention) gate every submission.

📋 Subtasks:
* FIMsim GUI – fimcore Package Extraction + Server-Safety Fixes (FIMSIM-BE1)
* FIMsim GUI – Tethys 4 App Scaffold + Repo Setup (FIMSIM-BE2) ✅
* FIMsim GUI – Project/AOI/StepRun Data Model + PostGIS Lookups (FIMSIM-BE3)
* FIMsim GUI – django-storages Wrapper + Per-User Key Isolation (FIMSIM-BE4)
* FIMsim GUI – Job Type Registry + DaskJob Wiring + Structured Progress (FIMSIM-BE5)
* FIMsim GUI – AOI Ingest Endpoints (Upload, Validate, Lookups) (FIMSIM-BE6)
* FIMsim GUI – Wizard Step Job Endpoints: DEM / Manning / BCI / BDY / PAR (FIMSIM-BE7)
* FIMsim GUI – LISFLOOD-FP Solver Build + Run Job Type (FIMSIM-BE8)
* FIMsim GUI – Outputs, Download + Result Post-Processing Endpoints (FIMSIM-BE9)
* FIMsim GUI – Resource Guards: AOI Cap, Quotas, Retention (FIMSIM-BE10)

🚦 Status: 🔄 Work in Progress

---

TASK GROUP: BYU CIROH: FIMsim-FE – Frontend React SPA

🎯 Goal: A guided wizard interface is built and served through Tethys so that a complete LISFLOOD-FP flood simulation can be configured, run, and its flood map viewed and downloaded without using the command line — replacing the desktop app's four duplicated PyQt wizards with one parameterized web wizard.

🛠️ What will be done: A React/TypeScript SPA will be developed covering the project/AOI setup with an interactive map (Step 1), the five data-prep step panels with per-AOI status cards (Steps 2–6), simulation submission with staged live progress (Step 7), and a results view with the flood map rendered as a map overlay plus one-click downloads (Step 8). A production Vite build will be integrated into the Tethys app template.

📋 Subtasks:
* FIMsim GUI – App Shell + Wizard Layout (FIMSIM-FE1)
* FIMsim GUI – Project + AOI Step: Map, Upload, Draw (FIMSIM-FE2)
* FIMsim GUI – Per-AOI Status Cards + Detected River/Gage Display (FIMSIM-FE3)
* FIMsim GUI – DEM + Manning Step Panels (incl. Editable Manning Table) (FIMSIM-FE4)
* FIMsim GUI – BCI + BDY Step Panels (incl. Hydrograph Preview Chart) (FIMSIM-FE5)
* FIMsim GUI – PAR Step + Run Submission UI (FIMSIM-FE6)
* FIMsim GUI – Running Step + Staged Progress Polling (FIMSIM-FE7)
* FIMsim GUI – Results Step: Flood-Map Overlay + Downloads (FIMSIM-FE8)
* FIMsim GUI – Project/Job History List (FIMSIM-FE9)
* FIMsim GUI – Production Build + Tethys Integration (FIMSIM-FE10)

🚦 Status: 🔜 To Do
