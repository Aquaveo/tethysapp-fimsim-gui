# FIMsim GUI — Sprint 4 tickets (BE9, BE10) + FE2 as-built/remaining

---

TASK: BYU CIROH: FIMsim GUI – Outputs, Download + Result Post-Processing Endpoints (FIMSIM-BE9)

Description: Everything that lets a user get results OUT: browse what a step produced, download single files or zips, and feed the map. BE8 creates the flood-map GeoTIFFs; this ticket serves them — including the web-displayable form (bounds-referenced PNG for the MapLibre overlay) that FE8 renders. Preserves the desktop's core promise for LISFLOOD/TRITON users: take the generated deck to your own solver if you want.

[   ]  Outputs listing endpoint: per StepRun and per AOI — filename, size, content type, storage key, produced-at; drawn from the BE4 manifest, never from directory listing
[   ]  Single-file download via short-lived presigned URL (browser pulls straight from MinIO/S3; Django never proxies bytes it doesn't have to)
[   ]  Per-step zip and whole-project zip endpoints, streamed (never buffered fully in RAM), with sensible archive layout (<project>/<aoi>/<step>/…) and correct filenames
[   ]  Map-overlay endpoint for raster results: GeoTIFF → PNG + WGS84 bounds JSON (color-ramped for depth, binary blue for extent), cached in storage next to the source so it's computed once
[   ]  Hydrograph/timeseries endpoint: produced *_strmflow_timeseries.csv returned as JSON series (FE5 preview + FE8 reuse)
[   ]  Every endpoint enforces ownership (user A cannot list, presign, or zip user B's artifacts) — covered by tests
[   ]  Deck-parity check: the per-AOI zip of a completed LISFLOOD prep contains exactly the file set the desktop would have produced (dem.ascii, lulc.ascii, .bci, .bdy, model.par) — asserted against the Neuse test case

Implementation Tasks
* api/stepruns/<id>/outputs, api/outputs/<key>/presign, api/aois/<id>/zip?step=…, api/projects/<id>/zip
* Zip streaming (zipstream-style generator over storage objects)
* Raster→PNG+bounds post-processor (rasterio + a fixed depth color ramp; reproject to EPSG:4326 bounds for MapLibre image source)
* Ownership guards as shared decorators with BE6's

Out of Scope
* FE8's rendering itself · COG tiling / a tile server (post-MVP v7 roadmap item — PNG bounds overlay is the MVP) · retention/cleanup (FIMSIM-BE10) · FIMeval hand-off integration (pending the time-step alignment discussion)

—

TASK: BYU CIROH: FIMsim GUI – Resource Guards: AOI Cap, Quotas, Retention (FIMSIM-BE10)

Description: The safety layer the desktop never needed but a public portal requires. The audit flagged unbounded AOI-area × resolution as the #1 risk (a large AOI at 1 m is a multi-gigapixel in-RAM raster), and the FIMecosystem meeting explicitly aligned on capping input shapefile area for system stability. Adds submission-time prechecks, per-user quotas, retention cleanup, and turns fimcore's silent failure modes into logged, visible ones.

[   ]  Pre-submission dimension check: predicted raster size (AOI bbox in working CRS ÷ cell size) computed BEFORE any job is created; over-cap rejected with the predicted size, the cap, and what to change (smaller AOI or coarser resolution)
[   ]  Simulation-cost precheck for BE8 runs: predicted cells × sim duration vs. a runtime budget derived from BE8's characterization runs
[   ]  Caps on AOIs per project and concurrently running jobs per user — both configurable app settings; at-cap submissions rejected with a clear message
[   ]  Per-user storage usage tracked (BE4's bytes_written accounting) and exposed via endpoint; submissions blocked over quota with usage shown
[   ]  Retention: artifacts older than the configured window cleaned from storage AND manifests marked expired; runs as a periodic job/management command; idempotent; every deletion logged
[   ]  fimcore's broad `except Exception: pass` sites (aoi_info, arc_run, dem) replaced with logged warnings — server-side failures are never silent (lands as a fimcore change with a test)
[   ]  Boundary tests: submit at cap and cap+1 for every guard; verify rejection UX and server health
[   ]  Default cap values documented with their derivation (worker-RAM budget, e.g. max predicted raster ≈ 500M cells ≈ 2 GB float32, halved) — final values are a team decision recorded in this ticket

Implementation Tasks
* Precheck utility (bbox-in-working-CRS ÷ cell size) wired into BE7's submit endpoints via the hook FE2/BE6 left in place
* Usage endpoint + quota middleware on submit/upload
* Retention command + scheduling note for the portal (cron/celery-beat equivalent available on CIROH portal = boss question #3)
* fimcore PR: exception-swallowing sweep → log_fn warnings
* Load-check script at the concurrency cap

Out of Scope
* Full security-audit/load-test battery (separate Testing & Hardening ticket, FIMeval-style) · billing beyond byte counts · admin UI for caps (app settings + Django admin suffice) · per-IP rate limiting (portal-level concern)

Notes: Cap VALUES need the team decision the meeting deferred ("that a cap exists" was aligned; the number wasn't). BE8's runtime characterization is an input — schedule after BE8's spike if possible.

—

TASK: BYU CIROH: FIMsim GUI – Project + AOI Step: Map, Upload, Draw (FIMSIM-FE2)

Description: The wizard's entry steps. The AOI half shipped early (client-side): MapLibre map with Esri basemaps, zipped-shapefile/GeoJSON upload parsed in-browser, rectangle draw with ghost preview and first-corner snap, the bundled Neuse example, and AOI cards with area/source/warnings. Remaining: the Project step (create/open against real records) and cutting the AOI step over from client-side parsing to the BE6 endpoints so AOIs persist and GeoPackage works.

[ ✓ ]  MapLibre map with Satellite/Street Esri basemaps, CONUS initial frame, nav controls (worker bundled for production)
[ ✓ ]  Upload zipped shapefile / GeoJSON; every polygon feature becomes its own AOI (desktop multi_aoi parity); actionable errors for unsupported/broken files
[ ✓ ]  Rectangle draw (two-click, live ghost, Esc cancel) per the meeting decision; free-polygon mode retained behind a per-model flag; rectangularity check on uploads with "Use bounding box" fix
[ ✓ ]  One-click example: Neuse River, NC (the desktop test case, reprojected)
[ ✓ ]  AOI cards: name, area km², source, zoom-to, remove, CONUS + rectangularity warnings
[   ]  Project step: create project (name validation feedback), open existing (list with created date + AOI count), delete with confirm — against BE6's project endpoints
[   ]  Wizard state keyed to a real project id (URL /new/<project_id> so refresh/resume works); AOI list loads from the server on open
[   ]  AOI step cut over to BE6: upload goes to storage via the server flow (gpkg now supported), drawn AOIs POSTed, cards reflect server-side validation verdicts
[   ]  Client-side shpjs parsing retired (or kept only as instant preview while the server ingests — decide with BE6, document)
[   ]  Multi-AOI regression re-verified against all three bundled test AOIs through the server path

Implementation Tasks (remaining)
* ProjectStep component: create form + open list (reuse SimulationsList styling), wired to BE6
* Route param for project id; wizard context provider replacing local useState
* AoiStep upload path swap + lookup-status polling ("resolving…" state feeding FIMSIM-FE3's river/gage display)

Out of Scope
* River/gage display on cards + map (FIMSIM-FE3) · step config panels (FE4+) · AOI editing after confirm (delete + re-add) · non-CONUS support

🚦 Status: 🔄 Work in Progress (AOI half shipped; Project half + server cutover blocked on FIMSIM-BE6)
