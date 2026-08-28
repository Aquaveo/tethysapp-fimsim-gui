# FIMsim GUI — tickets from the demo meeting (Aug 27, 2026)

---

TASK: BYU CIROH: FIMsim GUI – Corner-Click Enclosing-Rectangle Draw (FIMSIM-FE14)

Description: Demo + user feedback: the two-click rectangle hid the bounding box and closed too eagerly. Restore the corner-click interaction (Nth click on the first point closes the loop) while honoring the rectangular-mesh requirement by folding in Dinuke's suggestion: whatever shape the user traces commits as its smallest enclosing rectangle, previewed live while drawing.

[ ✓ ]  Drawing is vertex clicks; clicking the first point (≥3 vertices, 12px snap) or double-clicking closes
[ ✓ ]  The bounding rectangle of everything clicked (plus the cursor) previews LIVE as an amber outline + translucent fill — the user always sees exactly what will commit
[ ✓ ]  The committed AOI is the enclosing rectangle (Dinuke's smallest-enclosing-rectangle, axis-aligned) — irregular click patterns still yield a valid LISFLOOD/TRITON mesh
[ ✓ ]  Esc cancels; hint copy in the map bar + AOI step explains the behavior

Out of Scope
* Rotated minimum-area rectangles (axis-aligned only, matching the DEM grid)

🚦 Status: ✅ Complete (shipped 2026-08-29, commit 10463cd)

—

TASK: BYU CIROH: FIMsim GUI – Welcome Modal with Usage Limits (FIMSIM-FE15)

Description: Meeting action item (Reshma): "Inform users about the polygon area limitations upfront in the welcome modal." The app currently has no welcome modal; this creates one in the FIMBench format (family precedent) whose job is expectation-setting: what the app does, the AOI size cap, the 10 m DEM baseline, and where to go for bigger studies (the desktop app).

[   ]  First-visit modal (dismissible, "don't show again" via localStorage) in the FIMBench welcome-modal format
[   ]  States the AOI size limit with its value and why (processing cost/stability) — value comes from the group's pending cap decision; ship with the configurable default and update copy when the number lands
[   ]  States the DEM baseline: 10 m is the primary product; 1 m/3 m exist but increase simulation times substantially
[   ]  Points users needing large-scale case studies to the desktop FIMsim (link to Parvaneh's repo/releases)
[   ]  Direct link to project documentation (FIMSIM-FE13's docs page; GitHub until that ships)
[   ]  Copy reviewed against FIMBench's modal so the family reads consistently

Implementation Tasks
* Check FIMBench's welcome modal implementation (~/tethysdev/tethysapp-fimbench_gui) and mirror structure/styling
* Cap value + baseline copy sourced from app settings (BE10's caps), not hardcoded prose

Out of Scope
* Cap enforcement itself (FIMSIM-BE10) · docs content (FIMSIM-FE13) · anonymous-user flows (deprioritized by the meeting)

—

TASK: BYU CIROH: FIMsim GUI – Shared DEM/Land-Cover Cache Across Users (FIMSIM-BE11)

Description: Meeting direction (Gio): users running the same region should share downloaded data instead of re-fetching it, with periodic cleanup to control storage costs. Today every job downloads its own 3DEP tile windows into scratch and discards them (`dem_tiles` is deliberately excluded from the persisted workspace). A shared, storage-backed cache turns the most expensive part of every DEM/LULC job into a hit for popular regions.

[   ]  Cache layer keyed by source + tile/window identity (e.g. 3dep/<tile>/<window-hash>, lulc/<source>/<year>/<tile>) in a SHARED storage prefix (outside per-user isolation — read-only to jobs, written through the cache API only)
[   ]  DEM job path consults the cache before hitting USGS; misses populate it; hits are logged so effectiveness is measurable
[   ]  Freshness policy per dataset: DEM effectively static; land cover updates ~annually (Parvaneh) — cache entries carry the source year/version so a new NLCD/Esri vintage isn't masked by a stale hit
[   ]  Periodic cleanup: LRU/age-based eviction of large files on a monthly schedule (Gio owns the cron mechanism on the portal — coordinate; ship the cleanup command, let ops schedule it)
[   ]  Cache size cap + usage metric exposed (feeds the BE10 cost picture)
[   ]  Correctness guard: a cache hit must produce byte-identical step outputs vs. a cold fetch (test against the Neuse tile)

Implementation Tasks
* Cache read/write helpers on the BE4 storage service (shared prefix, atomic writes)
* Wire into fimcore's tile-fetch path via the job wrapper (fimcore change or a wrapper-level pre-stage of dem_tiles/ — prefer pre-staging to keep fimcore untouched)
* Eviction command + coordination note for Gio's cron
* Design sign-off with Gio before build (he owns the caching/cron direction)

Out of Scope
* Cross-region dedup beyond tile identity · CDN/edge caching · caching NWM time-series pulls (different access pattern; revisit post-MVP)

Notes: This is the "Optimize Data Cache" group action item made concrete for FIMsim. Not MVP-blocking — jobs work without it — but it's the biggest single cost/latency lever once multiple users exist.

—

AMENDMENTS to existing tickets (from the same meeting)

* FIMSIM-FE4 (DEM + Manning panels): the resolution control is now a decided
  requirement, not a design choice — dropdown of 1 m / 3 m / 10 m with
  **10 m as the default baseline**, plus the DEM source selector (3DEP/HAND +
  user upload). Parvaneh is adding the equivalent dropdown to the desktop and
  will notify Reshma — match her source/resolution naming when it lands.
* FIMSIM-BE10 (resource guards): the meeting re-affirmed strict AOI size caps;
  the cap VALUE is still a group decision ("Determine Polygon Limit").
  Rejection copy must direct large-scale case studies to the desktop app.
  The welcome modal (FE15) states the limit upfront — keep the two consistent
  by sourcing both from the same app setting.
* Login-required stays (meeting decision) — closes the auth part of
  design-brief decision #5; anonymous flows deprioritized. HydroShare
  integration (auth + saving results as HydroShare resources) is being
  explored by Gio + Nathan — no FIMsim work yet, but BE9's outputs design
  should not preclude exporting a result bundle to an external resource.
