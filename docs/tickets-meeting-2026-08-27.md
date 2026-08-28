# FIMsim GUI — tickets from the demo meeting (Aug 27, 2026)

---

TASK: BYU CIROH: FIMsim GUI – Corner-Click Enclosing-Rectangle Draw (FIMSIM-FE14)

Description: Restore corner-click drawing (two-click rectangle hid the bounding box and closed too eagerly) and fold in Dinuke's suggestion: any traced shape commits as its smallest enclosing rectangle, previewed live.

[ ✓ ]  Vertex clicks; clicking the first point (≥3 vertices) or double-clicking closes; Esc cancels
[ ✓ ]  Enclosing rectangle previews live (outline + fill) while drawing
[ ✓ ]  Commit = the enclosing rectangle (axis-aligned) — irregular shapes still yield a valid LISFLOOD/TRITON mesh
[ ✓ ]  Hint copy updated in map + AOI step

Out of Scope: rotated minimum-area rectangles.

🚦 Status: ✅ Complete (commit 10463cd)

—

TASK: BYU CIROH: FIMsim GUI – Welcome Modal with Usage Limits (FIMSIM-FE15)

Description: Meeting action item: state the usage limits upfront in a first-visit welcome modal, FIMBench format.

[   ]  First-visit modal, dismissible, "don't show again" (localStorage)
[   ]  States the AOI size cap + why; value read from the same app setting BE10 enforces
[   ]  States the 10 m DEM baseline (1 m/3 m cost more compute)
[   ]  Points large-scale studies to the desktop FIMsim; links to documentation

Implementation Tasks
* Mirror FIMBench's welcome modal structure/copy style
* No hardcoded limit values — source from app settings

Out of Scope: cap enforcement (BE10) · docs content (FE13) · anonymous flows (deprioritized).

—

TASK: BYU CIROH: FIMsim GUI – Shared DEM/Land-Cover Cache Across Users (FIMSIM-BE11)

Description: Users running the same region should share downloaded data (Gio). Jobs currently discard their DEM tile scratch; a shared storage-backed cache makes repeat regions fast and cheap.

[   ]  Shared cache prefix keyed by dataset + tile + vintage (land cover updates ~annually — stale vintages must not mask new ones)
[   ]  DEM/LULC job path checks cache before fetching; misses populate it; hits logged
[   ]  Monthly eviction command (Gio schedules the cron); cache size cap + usage metric
[   ]  Correctness: cache hit produces byte-identical outputs vs. cold fetch (Neuse test)

Implementation Tasks
* Cache helpers on the BE4 storage service; pre-stage dem_tiles/ in the job wrapper (avoids touching fimcore)
* Design sign-off with Gio first

Out of Scope: NWM time-series caching · CDN/edge caching.

Notes: Not MVP-blocking; biggest cost/latency lever once multiple users exist.

—

AMENDMENTS

* FIMSIM-FE4: DEM resolution dropdown is now a decided requirement — 1 m / 3 m / 10 m, **10 m default**; match Parvaneh's desktop source/resolution naming when she notifies Reshma.
* FIMSIM-BE10: cap VALUE still owed by the group; rejection copy directs large studies to the desktop app; modal (FE15) and enforcement read the same setting.
* Auth: login-required stays (closes design-brief decision #5's auth question); HydroShare integration under exploration (Gio+Nathan) — BE9's output design shouldn't preclude exporting result bundles.
