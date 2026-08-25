# FIMsim GUI — completed tickets (as-built records)

---

TASK: BYU CIROH: FIMsim GUI – fimcore Package Extraction + Server-Safety Fixes (FIMSIM-BE1)

Description: Lift the desktop FIMsim repo's `core/` (~13.6k lines, already Qt-free) into a standalone installable package, `fimcore`, that both the desktop app and the Tethys app depend on. The extraction is mostly mechanical; the real work is removing the process-global side effects that are harmless in a single-user desktop process but fatal in a shared Django/Dask worker. Extracted from `pnikrou/FIMsim` @ `e14a5a1` (v1.1).

[ ✓ ]  pip install -e . succeeds with no PyQt/PySide in the dependency tree (dead deps dropped: nencarta, PyQt5, gmsh, h5py; fimserve/arc are optional extras with lazy imports)
[ ✓ ]  import fimcore triggers no network calls, no os.environ writes, no os.chdir, no SSL-context change — pinned by an automated test over all 33 modules
[ ✓ ]  All 7 global ssl bypass sites removed; HAND's verify=False fallback replaced with a clear CA-bundle error (TACC's cert verifies against standard bundles — confirmed live)
[ ✓ ]  os.chdir removed from FIMservAPI.__init__; every fimserve call now runs inside a lock-serialized _workdir() context that always restores the previous CWD
[ ✓ ]  GDAL/PROJ tuning applied via rasterio.Env entered INSIDE thread-pool workers (Env is thread-local — wrapping the executor would silently do nothing)
[ ✓ ]  Module-level caches replaced with a thread-safe LRU (fimcore._cache.BoundedCache); HAND VSI cache trimmed 1 GB → 256 MB for shared workers
[ ✓ ]  us_huc8/us_huc6/us_states GeoJSONs ship as package data, lazy-loaded
[ ✓ ]  Live smoke test passes: Neuse test AOI → real 3DEP download → DEM_AOI_1.tif + lisflood-files/dem.ascii, fully headless
[ ✓ ]  Concurrency regression: two AOIs looked up in 4 parallel threads produce results identical to sequential runs

Implementation Tasks (as done)
* src-layout package at fimcore/; imports rewritten core.* → fimcore.*; data paths repointed into package data
* pyproject with the real dependency set (grep-derived) + extras [fimserv], [arc], [dev]
* Test suite (first ever for this code): side-effect guard, source-level TLS policy check, concurrent-lookup regression, cache-thrash, network-marked DEM smoke test
* Entry-point inventory documented at docs/step-functions.md — the API contract for FIMSIM-BE7

Out of Scope (unchanged from plan)
* Structured progress events (FIMSIM-BE5) · ctx→Django models (FIMSIM-BE3) · orchestrator unification · upstream PR to pnikrou/FIMsim · web exposure of TRITON/ARC/FIMserv

Notes: Repo is local at ~/tethysdev/fimcore pending a decision on its GitHub home. Follow-up discovered during work: the portal's tethys conda env has broken pyproj (transforms return inf) — must be fixed before BE5 runs fimcore under the portal.

🚦 Status: ✅ Complete

—

TASK: BYU CIROH: FIMsim GUI – Tethys 4 App Scaffold + Repo Setup (FIMSIM-BE2)

Description: Stand up the Tethys 4 application and its repository following the fimeval-gui house conventions, so all subsequent backend and frontend tickets have a home that installs cleanly into a Tethys portal.

[ ✓ ]  Repo created: github.com/Aquaveo/tethysapp-fimsim-gui (private, matching fimeval-gui), package tethysapp/fimsim_gui, root_url fimsim-gui
[ ✓ ]  App class follows the house pattern: catch_all='home' for SPA client-side routing, MinIO/S3 custom settings, dask_primary SchedulerSetting
[ ✓ ]  pyproject.toml + install.yml per fimeval-gui conventions; baseline deps boto3, dask[distributed], django-storages[s3], moto[s3]; nodejs via conda; scripts/build_frontend.sh as the install post-hook
[ ✓ ]  App icon + favicon wired (favicon.io assets)
[ ✓ ]  Installed and registered in the dev Tethys portal; /apps/fimsim-gui/ serves; statics + bundle verified with 200s
[ ✓ ]  MinIO custom settings populated in the portal admin
[ ✓ ]  Design brief + task-group docs vendored under docs/

Implementation Tasks (as done)
* tethys scaffold base, then aligned to fimeval-gui (pyproject metadata, install.yml, catch-all controller rendering the SPA index template)
* pip install -e . + tethys install -d against the dev portal; smoke-tested portal, app URL, favicon, logo, JS bundle

Out of Scope
* Data models (FIMSIM-BE3) · storage wrapper (FIMSIM-BE4) · any endpoints (FIMSIM-BE6+)

🚦 Status: ✅ Complete

—

TASK: BYU CIROH: FIMsim GUI – App Shell + Wizard Layout (FIMSIM-FE1)

Description: Build the React/TypeScript SPA shell the entire app lives inside, visually uniform with FIMeval/FIMbench (explicit stakeholder requirement: one FIM-ecosystem look), with the LISFLOOD-FP wizard as a data-driven step sequence so later models are a steps-list away, not new components.

[ ✓ ]  Vite + React 19 + TS scaffold mirroring fimeval-gui's contract (same tsconfigs, build output shape, dev proxy)
[ ✓ ]  FIM-family chrome: Header-HQ/Footer-HQ/FilterSidebar banners, partner-logo footer, 'Alan Sans', FIMbench palette adopted VERBATIM (cyan #25C2DF system; theme.ts mirrors FIMbench's COLORS)
[ ✓ ]  Workspace layout: navy left nav (＋ New Simulation, Documentation, Simulations list, Signed in), detail pane, branded footer — Simulations list lives inside the nav per stakeholder feedback
[ ✓ ]  react-router with BASE_URL basename (routes /new, /docs); deep links survive refresh via catch_all
[ ✓ ]  Nine-step LISFLOOD-FP wizard defined as data (src/steps.ts), each step with real copy + produced-file label
[ ✓ ]  Vertical "river" stepper beside the step card — dots fill cyan with checkmarks, connector fills downstream; sticky; sizing tuned interactively (32px dots, 1.15rem reach, 74rem wrap); collapses to a horizontal dot strip <820px
[ ✓ ]  ← Back / Next → navigation per FIMeval's structure; a11y basics (focus-visible, reduced-motion)

Implementation Tasks (as done)
* AppShell/Header/Footer/SimulationsList components on the wk-* class conventions; NewSimulation wizard on ns-* (FIMeval's ne-* pattern)
* Placeholder panels per step, replaced incrementally from FE2 on
* Several stakeholder-feedback iterations: palette correction to FIMbench tokens, sidebar merge, stepper orientation + spacing, badge contrast

Out of Scope
* Real step content (FE2+) · welcome modal (separate FIMeval-side item) · docs content (FIMSIM-FE13)

🚦 Status: ✅ Complete

—

TASK: BYU CIROH: FIMsim GUI – Production Build + Tethys Integration (FIMSIM-FE10)

Description: Make the SPA a first-class Tethys citizen: production Vite build served by the app's catch-all controller, automated on install, working identically in dev without a running portal. (Completed early — FE1 needed it to be demoable through the portal.)

[ ✓ ]  Production build emits to tethysapp/fimsim_gui/public/frontend (main.js/main.css contract identical to fimeval-gui); built bundle git-ignored, .gitkeep preserved
[ ✓ ]  Tethys index template loads the bundle via {% static %}; catch-all home controller renders it for any sub-path
[ ✓ ]  install.yml post-hook (scripts/build_frontend.sh) runs npm ci + build on tethys install — cwd-independent
[ ✓ ]  Base URL correct in both worlds: '/' in dev, '/apps/fimsim-gui/' in production
[ ✓ ]  MapLibre worker bundled explicitly (?worker&url) so the production build doesn't 404 the worker — verified emitted in assets/
[ ✓ ]  Dev server serves the app's own statics at /static/fimsim_gui/ via an inline Vite plugin (path-traversal-guarded, correct content types) so family chrome renders without Tethys running; other /static and /apps paths proxy to :8000
[ ✓ ]  Verified through the portal: app URL, favicon, logo, bundle all 200

Implementation Tasks (as done)
* vite.config.ts: production base, fixed output names, alias, proxies, statics-serving plugin, import.meta.dirname
* Template + controller per fimeval-gui; install verified end-to-end on the dev portal

Out of Scope
* CI builds · bundle code-splitting (main.js ~386 kB gzip — same weight class as fimeval-gui; revisit post-MVP)

🚦 Status: ✅ Complete
