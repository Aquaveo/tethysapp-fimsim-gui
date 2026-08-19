# FIMsim → Tethys Web App: Design Brief

**Prepared by:** R. Raghavan (Aquaveo) · August 2026
**Status:** Draft for internal review — decisions needed before implementation begins
**Target:** Tethys app on the CIROH portal, part of the FIM ecosystem

---

## 1. Purpose

FIMsim (github.com/pnikrou/FIMsim, by Parvaneh Nikrou) is a desktop
PyQt6 application that removes the technical barrier to setting up 2D flood
simulations. We want a web version on the CIROH Tethys portal so users need no
installation at all. This brief summarizes a full code audit of FIMsim v1.1,
proposes an architecture and phasing, states the expected cost (near zero for the
recommended path), and lists the decisions we need from leadership and the FIMsim
author before starting.

## 2. What FIMsim does today (audit summary)

Eight tools in two tracks, all driven by a user-supplied Area of Interest polygon:

| Track | Tools |
|---|---|
| **Standalone input prep** | DEM (USGS 3DEP / TACC HAND) · LULC + editable Manning's n (NLCD / Esri Sentinel-2) · Flowlines (NHD + USGS gauges) · Streamflow time series (NWM retrospective & forecast, USGS gauges) |
| **Flood-mapping pipelines** | LISFLOOD-FP · TRITON · ARC-Curve2Flood · OWP HAND-FIM |

Key audit findings that shape the port:

1. **FIMsim never executes a solver binary.** The LISFLOOD-FP and TRITON wizards
   generate complete input decks (`.par`/`.bci`/`.bdy`, `.cfg`/`.hyg`/ASCII grids);
   users run the solvers themselves. Only ARC-Curve2Flood and OWP HAND-FIM produce
   actual flood maps, and both run as pure-Python pip packages (`arc`,
   `curve2flood`, `fimserve`) — no external binaries anywhere in the app.
   *Note: the v1.1 README describes "cloud execution of complete flood mapping
   simulations," which the current code does not do — we need the author's intent
   clarified (Decision 1).*
2. **All input data comes from free public services** — USGS 3DEP, NHD, MRLC/NLCD,
   Esri Sentinel-2 land cover, NOAA NWM on AWS/GCS open buckets, TACC HAND, USGS
   Water Services. No licensed or paid data. "Local resources" in the desktop app
   means local *processing*, not local data.
3. **The workload is network-I/O bound, not compute bound.** Typical steps run
   minutes to tens of minutes per AOI, dominated by tile/Zarr downloads; the one
   real computation (ARC-Curve2Flood) is "several minutes per AOI" on CPU.
   Projects produce hundreds of MB to a few GB of rasters.
4. **The backend is already web-ready.** `core/` (~13.6k lines) has zero Qt
   imports; every long-running function is a blocking call taking a config dict
   and a logging callback — a near-perfect fit for the Tethys Jobs API.
5. **~30% of the GUI is copy-paste.** Four ~1,100-line multi-AOI widgets and three
   parallel orchestrators are byte-near-identical. The web port defines the wizard
   once, parameterized by model — we port far less than the raw 44k lines suggests.
6. **Technical debt to fix during the port** (fine on a desktop, unacceptable on a
   shared server): SSL verification globally disabled in ~10 places; `os.chdir`
   in a constructor; process-global GDAL/env mutation; unbounded module-level
   caches; **no cap on AOI area × DEM resolution** (a large AOI at 1 m resolution
   consumes unbounded RAM/disk — the #1 guard needed on a public portal); no
   tests; progress reported by regex-scraping log strings.

## 3. Architecture options

### Option 1 — Shared-core Tethys app (recommended)

Extract `core/` into a standalone package (working name **`fimcore`**) consumed by
both the desktop app and the new Tethys app. The Tethys app adds:

- **One parameterized step wizard** replacing the four duplicated desktop wizards
  (the step sequence — Project → AOI → DEM → roughness → boundary conditions →
  flow data → config/run — is nearly identical across models and becomes data,
  not code).
- **Tethys Jobs API** for long-running steps; the existing `log_fn` callback is
  redirected into structured progress events streamed to the browser.
- **Interactive web map** (OpenLayers/MapLibre gizmo) replacing matplotlib
  previews: AOI upload or draw-on-map, flowline/gauge display, raster overlays.
- **Django/PostGIS models** replacing the per-AOI `workflow_context.json`
  key-value bag (Project → AOI → StepRun records); the bundled 41 MB HUC8
  GeoJSON becomes a PostGIS table.
- **Per-user workspace storage** with a download-zip button per completed step,
  preserving the desktop's "take these files to your solver" behavior.

*Trade-off:* requires the FIMsim author's buy-in to restructure their repo (or we
fork and periodically sync, which is worse). *Cost:* $0 beyond existing portal
hosting, assuming the portal provides a job runner and reasonable disk.

### Option 2 — Straight port, self-contained fork

Copy `core/` into the Tethys app, fix the hazards, don't coordinate upstream.
Fastest start, zero coordination — but the author ships fast (26k new lines in the
last release cycle) and every upstream improvement must be re-ported by hand.
Fallback if the author declines restructuring.

### Option 3 — Thin portal over a remote execution service

Tethys app is UI-only; jobs run on separate infrastructure (CIROH cloud
allocation, TACC, or an EC2 autoscaling group). This is the right shape **only if**
server-side LISFLOOD-FP/TRITON execution is mandated (TRITON wants a GPU, which
shouldn't live inside the portal). It is the only option that costs real money.
Importantly, it can be **layered onto Option 1 later** — the Tethys Jobs API
abstracts where jobs run, so swapping the local scheduler for a remote Dask/HPC
scheduler is a supported evolution, not a rewrite.

## 4. Recommended phasing (Option 1)

| Phase | Scope | Rationale |
|---|---|---|
| **1** | The four standalone input-prep tools (DEM, LULC/Manning, Flowlines, Streamflow) + all shared plumbing (AOI upload/draw, map, jobs, storage, download) | Simplest tools; immediately useful on their own; builds every piece of infrastructure the pipelines need |
| **2** | OWP HAND-FIM pipeline, then ARC-Curve2Flood | Both pure Python; both produce actual flood maps rendered on the portal map — the strongest demo |
| **3** | LISFLOOD-FP and TRITON input-deck wizards (generate + download zip) | Completes desktop parity |
| **4** *(optional, if mandated)* | Server-side solver execution via remote scheduler | Deferred until Decision 1 requires it and compute is identified |

## 5. Cost

**Phases 1–3 require no new procurement.** Free public data sources, minutes-scale
CPU jobs, hosting presumably provided by the CIROH portal. The only scenarios with
real cost:

- **Server-side TRITON** (GPU node) — only if Decision 1 mandates it; first ask
  whether CIROH/UA compute allocations (TACC, CIROH AWS/GCP) can cover it for free.
- **Insufficient portal disk** — cheap fix is an S3 bucket for finished project
  archives (estimated $2–5/month at plausible usage); confirm portal quotas first
  (Decision 3) before assuming it's needed.

## 6. Decisions needed

1. **Solver execution.** Must the web version *run* LISFLOOD-FP and TRITON
   server-side, or is "prepare inputs + download zip" acceptable at least
   initially? What did the author's README claim of "cloud execution" intend, and
   is there existing CIROH/UA compute (TACC, CIROH cloud allocations) available
   before purchasing anything?
2. **MVP priority.** Which matters most to CIROH users first — the standalone
   data-prep tools (Phase 1 as proposed) or one flagship end-to-end pipeline?
3. **CIROH portal infrastructure.** What does a Tethys app there get: job runner
   (Celery/Dask/HTCondor)? PostGIS? Per-app disk quota and per-job runtime
   limits? Who administers deployment?
4. **Upstream coordination.** Is the FIMsim author open to splitting `core/` into
   a shared `fimcore` package used by both desktop and web? (Option 1 vs. a hard
   fork.)
5. **Public-facing policy.** Login required (portal accounts)? Per-user quotas?
   Project retention/cleanup period? We will add AOI-size × resolution caps
   regardless.
6. **Data-source blessing.** Any objection to a CIROH-hosted service hitting the
   public sources above at multi-user scale? (Esri's Sentinel-2 ImageServer and
   the MRLC WMS are the two most plausible rate-limit risks.)

---

*Backup detail available on request: full audit report covering per-mode step
maps, every external endpoint used, dependency analysis, persistence format, and
a file-level accounting of the code duplication.*
