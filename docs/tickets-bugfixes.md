# FIMsim GUI — bug-fix tickets (as-built records, Sep 2026)

Found and fixed during post-MVP click-through verification (Sep 1–3). All are
complete; BF2 lives in the shared fimcore package, the rest in this repo.

---

TASK: BYU CIROH: FIMsim GUI – Production Asset Base Fix: Invisible Flood Overlay & Dead Map Layers (FIMSIM-BF1)

Description: In the production bundle, every GeoJSON map layer was silently dead — no AOI outlines, flowlines, gages, zoom-to-AOI, or flood overlay — while the Vite dev server showed everything, so the map UX had been approved against dev and quietly broken on the portal. Root cause: Vite's `base` pointed at the app's ROUTE prefix (`/apps/fimsim-gui/`), so MapLibre's worker script resolved to the SPA catch-all, received HTML, and died without an error. Diagnosed end-to-end in a headless browser (Playwright) against the live portal.

[ ✓ ]  `base` points at the statics prefix (`/static/fimsim_gui/frontend/`); the router basename is hardcoded to the app path instead of deriving from BASE_URL
[ ✓ ]  Worker script loads as JavaScript from Tethys statics (verified in the bundle and over the wire)
[ ✓ ]  Headless-browser verification: map `load` fires, view auto-zooms to the AOI, overlay layer + source present, overlay PNG fetched 200, flood renders over the basemap
[ ✓ ]  Map instance exposed on `window` as a debugging escape hatch for future headless tests

Implementation Tasks (as done)
* vite.config.ts base split from router basename (router.tsx); rebuild; screenshot-verified before/after

Out of Scope
* The dry-simulation issue the verification also surfaced (FIMSIM-BF2)

🚦 Status: ✅ Complete

—

TASK: BYU CIROH: FIMsim GUI – fimcore: Inflow Point on Nodata Collar Produces Bone-Dry Simulations (FIMSIM-BF2)

Description: A defaults-only Neuse run at 90 m produced max depth 0.00 m. The mass balance showed `Qerror == Qin` — LISFLOOD-FP silently discards inflow placed on a nodata cell. fimcore shifts the upstream point a fixed 100 m inside the domain, but reprojection leaves a nodata collar around the rotated grid that is wider than 100 m at coarse resolutions (~1 cell at 90 m). Also found: the web defaults omitted the downstream bed slope, so every `.bci` wrote `FREE None`.

[ ✓ ]  fimcore `create_bci` walks the inflow point toward the AOI centroid one cell at a time until it samples valid terrain (bounded, warns + keeps the original on failure); logs the snap distance
[ ✓ ]  Web BCI defaults ship the desktop's 0.0001 bed slope; the Boundaries form exposes it when free outflow is selected
[ ✓ ]  Verification rerun floods correctly: max depth 9.83 m, 101 km² wet (was 0.00 m / 0 km²)

Implementation Tasks (as done)
* `_snap_to_valid_dem()` in fimcore/bci.py (Aquaveo/fimcore b9ec64a); `downstream_slope` default + form field in this repo

Out of Scope
* Upstream PR of the snap to pnikrou/FIMsim (tracked with the "(1).bdy" parser heads-up for Parvaneh)

🚦 Status: ✅ Complete

—

TASK: BYU CIROH: FIMsim GUI – Re-Runs Could Execute a Superseded Model Deck (FIMSIM-BF3)

Description: Restored workspaces kept superseded step outputs, so fimcore's `next_free_path` versioned fresh files as `"name (1).ext"` while the `.par` and the run job kept resolving the stale canonical names. Observed live: a corrected `.bci` never reached the solver — the rerun reproduced the old dry result byte-for-byte. Same mechanism duplicated every file in the Results table.

[ ✓ ]  Every job type declares `clean_patterns`; the wrapper deletes them right after the workspace restore, so regenerated files always take the canonical name (wildcards also sweep pre-existing "(1)" leftovers — self-healing)
[ ✓ ]  The run step clears the stale `results/` dir (it faked progress counts and could hand collect() a superseded `.max`)
[ ✓ ]  `_sanitize_deck` picks the newest `.par` by mtime, not alphabetically ("model (1).par" sorts before "model.par")
[ ✓ ]  Regression tests: clean_workspace per step, versioned-leftover sweep, newest-deck pick

🚦 Status: ✅ Complete

—

TASK: BYU CIROH: FIMsim GUI – PROJ Flake: Retry + Never Strand a Run (FIMSIM-BF4)

Description: The env's intermittent PROJ inf-breakage tripped the worker sanity check on a lookup job — and because the check ran before the job's try block, the AOI sat "pending" forever with no recorded error (step runs could likewise strand in "queued"). The same worker transformed correctly minutes later, confirming the flake is transient.

[ ✓ ]  Sanity check re-points the wheel data dir and retries (3 attempts) before condemning the worker
[ ✓ ]  Check moved inside each job's try block: a PROJ failure now marks the StepRun failed / the lookup failed with the reason, never a silent stuck state

🚦 Status: ✅ Complete

—

TASK: BYU CIROH: FIMsim GUI – Surface Real Failure Reasons: Per-AOI 503s & Expired Sessions (FIMSIM-BF5)

Description: Two failure modes reached users as noise. (1) When a submit rejected every AOI, the server's per-AOI reasons were discarded by the API client, which showed only "Request failed (503)". (2) When a Tethys idle session expired, fetch silently followed the login redirect and the UI crashed with "Cannot read properties of null (reading 'aois')".

[ ✓ ]  Non-2xx bodies carrying per-AOI `results` pass through to the panels, which render each AOI's reason; the generic fallback hints the job system may be restarting
[ ✓ ]  A 200-HTML response now throws a clear "session expired — sign in again" error instead of a null crash
[ ✓ ]  Both behaviors pinned by frontend unit tests (api client error contract)

🚦 Status: ✅ Complete

—

TASK: BYU CIROH: FIMsim GUI – Results Table & Zip: Deduplicate Cumulative Manifests (FIMSIM-BF6)

Description: Each step's manifest re-ships the whole deck, so the Results table and the Download-All zip listed the same file under every step — 89 rows / 93 zip entries for a single-AOI project.

[ ✓ ]  Table and zip list each filename once, under the step that first produced it (deterministic: steps walked in wizard order) — 25 files for the same project
[ ✓ ]  Zip dedupe is server-side, so downloads shrink too

🚦 Status: ✅ Complete

—

TASK: BYU CIROH: FIMsim GUI – Hydrograph Chart: True Discharge Units (FIMSIM-BF7)

Description: The chart plotted the `.bdy` file, whose values are LISFLOOD-FP's inflow per metre of cell width (Q ÷ cell size) — so the same event showed a different "peak" at every DEM resolution (54.4 at 30 m vs 18.1 at 90 m for a real peak of 1,631.8 m³/s), which read as a data bug during the demo dry-run.

[ ✓ ]  BDY step also ships the raw discharge CSV (true m³/s); the chart prefers it, so the peak is resolution-independent (Neuse/Matthew: 1,631.8 m³/s, matching NWM)
[ ✓ ]  `.bdy` fallback is labeled m²/s; the per-metre-width semantics are explained in the in-app docs' file-format reference
[ ✓ ]  Parsers pinned by frontend unit tests

🚦 Status: ✅ Complete
