# FIMsim GUI — tickets from the FIMsim demo meeting (Aug 2026)

---

TASK: BYU CIROH: FIMsim GUI – Rectangle Draw for AOIs (FIMSIM-FE11)

Description: The demo meeting aligned on a constraint from Parvaneh: AOI polygons for LISFLOOD-FP and TRITON must be rectangular — these tools are not designed for catchment-scale analysis, and users define a rectangular study area regardless of boundaries. The current draw tool produces free-form polygons, which implies a capability the models won't honor. Replace it with a rectangle draw for the LISFLOOD-FP wizard, keeping the free-polygon implementation available for the post-MVP models that accept arbitrary AOIs (OWP HAND-FIM, ARC).

[   ]  Draw mode produces axis-aligned rectangles: first click sets one corner, live ghost preview follows the cursor, second click sets the opposite corner and finishes
[   ]  Esc cancels an in-progress rectangle
[   ]  Drawn AOI cards and the map layer behave exactly as before (area, zoom-to, remove)
[   ]  Non-rectangular uploaded features are detected and handled: user is warned and offered "use bounding box instead" (confirm with Parvaneh whether auto-bbox matches desktop behavior before finalizing the wording)
[   ]  The free-polygon draw code path remains available behind a per-model flag (not user-visible in the LISFLOOD-FP MVP)

Implementation Tasks
* Replace the click-to-vertex handlers in AoiMap with a two-click rectangle mode (corner → live preview → opposite corner)
* Rectangularity check for uploads: 5-vertex closed ring with two unique lons + two unique lats (with tolerance), or compare ring area to bbox area within epsilon
* Warning UI on the AOI card / upload error area with the "use bounding box" action
* Parameterize draw mode from the step/model config so future wizards can re-enable free polygons

Out of Scope
* Rotated rectangles (axis-aligned only, matching how the DEM grid is clipped)
* Server-side rectangularity validation (arrives with FIMSIM-BE6)
* Any change to HAND-FIM/ARC AOI handling (post-MVP)

—

TASK: BYU CIROH: FIMsim GUI – Drawn-Polygon Shape Guidance (FIMSIM-FE12)

Description: Per Parvaneh: when users draw polygons, the interface should tell them the shape must be square for LISFLOOD-FP and TRITON. (The meeting decision recorded "rectangular"; Parvaneh's follow-up said "square" — confirm the exact requirement with her before finalizing copy. If rectangular is correct, FIMSIM-FE11's rectangle draw plus this note covers it; if genuinely square, FE11's draw mode must also constrain the aspect ratio.)

[   ]  The draw-mode hint bar states the shape requirement for LISFLOOD-FP/TRITON in plain language
[   ]  The AOI step's helper text mentions the requirement before the user starts drawing (not only during)
[   ]  Copy confirmed with Parvaneh: "square" vs "rectangular"
[   ]  If "square" is confirmed: draw mode enforces equal sides (preview snaps to square) rather than only warning

Implementation Tasks
* Update the am-draw-hint text and the AOI step hint line with the confirmed wording
* If square is confirmed: constrain the rectangle preview/commit in AoiMap to equal width/height (in projected meters, not degrees — a degree-square isn't a ground-square)
* Ask Parvaneh which requirement is real and record the answer in this ticket

Out of Scope
* Enforcement for uploaded files beyond FIMSIM-FE11's rectangularity warning

Notes: Small ticket, but the square-vs-rectangular ambiguity changes FE11's geometry constraint — resolve the question before building FE11's commit logic.

—

TASK: BYU CIROH: FIMsim GUI – In-App Documentation from GitHub + manual_site (FIMSIM-FE13)

Description: MVP requirement from the demo meeting: incorporate documentation from GitHub into the app. Sources are the FIMsim repo's README (workflow overview) and the existing HTML manual website (pnikrou/FIMsim manual_site/ — the collapsible user manual with per-step screenshots), with Parvaneh and Dipsikha supporting the effort. Replaces the current Docs placeholder page.

[   ]  Docs page presents the LISFLOOD-FP workflow: overview + one section per wizard step (Project, AOI, Terrain, Roughness, Boundaries, Flow Data, Settings), adapted from manual_site's Part 1/Part 2 structure
[   ]  Relevant manual_site screenshots included where they clarify a step (with Parvaneh's OK); desktop-specific UI references rewritten for the web wizard
[   ]  Workflow diagram (FIMsim_workflow.png) shown on the overview
[   ]  Content is vendored into the SPA (versioned with the app) — no dependency on external hosting; links out to the GitHub repo and SDML ecosystem page for the full desktop manual
[   ]  Sections deep-linkable (/docs#dem etc.) so step panels can link to their doc section later
[   ]  Renders acceptably at 1280×800 and on narrow panes (images max-width 100%)

Implementation Tasks
* Extract and adapt the per-step content from manual_site/index.html (structure: intro, AOI, Part 1 standalone tools, Part 2 model wizards — take the LISFLOOD-FP-relevant parts for MVP)
* Copy needed screenshots into reactapp assets (optimize sizes; the originals run up to ~1 MB each)
* Build the Docs route as a sectioned page with an in-page table of contents
* Confirm attribution/credit line with Parvaneh (manual is her work)

Out of Scope
* Docs for TRITON/HAND-FIM/ARC wizards (post-MVP, follows the same pattern)
* A docs search
* Auto-syncing content from the upstream repo (manual snapshot is fine for MVP; revisit if the manual churns)
