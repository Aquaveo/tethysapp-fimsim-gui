# FIMsim GUI — Sprint 5 tickets (FE3–FE5)

---

TASK: BYU CIROH: FIMsim GUI – Per-AOI Status Cards + Detected River/Gage Display (FIMSIM-FE3)

Description: Turn the AOI cards into the wizard's per-area dashboard — the web version of the desktop's AOI card rail — and put the BE6 lookup results on the map. After an AOI is confirmed, the user should see at a glance: which river was detected, which USGS gages are available (these drive FE5's BDY options), where the upstream/downstream endpoints sit, and how far each AOI has progressed through the steps. Card scaffolding (name/area/source/zoom/remove/warnings) shipped with FE2's first cut.

[ ✓ ]  Card basics: name, area km², source, zoom-to, remove, CONUS + rectangularity warnings
[   ]  Lookup lifecycle on the card: "resolving…" (spinner) while the BE6 lookup job runs → resolved fields (state, HUC8s, main river name, gage count) → distinct failed state with a retry action (network lookups WILL flake)
[   ]  Map layers per AOI: detected main-river flowline (line), USGS gage markers (click → popup with gage id, name, link to NWIS), upstream/downstream endpoint markers (distinct symbols — these become FE5's BCI anchors)
[   ]  Layer toggles or sensible defaults so multiple AOIs' flowlines/gages don't turn the map to soup (dim non-selected AOI layers; selected card highlights its layers)
[   ]  Per-step status chips on each card: DEM / Roughness / Boundaries / Flow / Settings / Run as small dots — pending (grey), running (pulsing), done (cyan ✓), failed (red) — fed by StepRun statuses; clicking a chip jumps the wizard to that step
[   ]  Cards live-update while jobs run (poll the same status endpoints FE7 uses; shared polling hook, one interval per project not per card)
[   ]  Empty/edge states: AOI with no detected river ("no NHD flowline found — BDY will need a gage or CSV"), no gages, lookup disabled offline

Implementation Tasks
* Extend the Aoi client model with lookup + step-status fields from BE6/BE7 payloads
* GeoJSON layers + symbols in AoiMap for flowlines/gages/endpoints; selection-driven styling
* StatusChips component + shared useProjectStatus polling hook (FE7 reuses it)
* Retry-lookup action → BE6 resubmit

Out of Scope
* Step configuration itself (FE4–FE6) · run progress detail view (FE7) · editing lookups by hand (post-MVP)

🚦 Status: 🔄 Work in Progress (card scaffolding shipped; display + status layers blocked on FIMSIM-BE6/BE7)

—

TASK: BYU CIROH: FIMsim GUI – DEM + Manning Step Panels (FIMSIM-FE4)

Description: The first two data-prep panels, replacing their placeholders. DEM is the simpler form (BE5/BE7 proved its backend path first); Manning carries the desktop's signature feature — the editable per-class Manning's n table — which must survive the trip to the web intact, because it's the step where a hydrologist's judgment actually enters the pipeline.

[   ]  DEM panel: source (USGS 3DEP / TACC HAND), resolution with the auto-derived default shown and editable, output format; optional "use my own DEM" upload (BE6 presign path)
[   ]  DEM submit fans out per AOI (BE7); per-AOI progress rendered on the FE3 cards; completed DEM renders as a grayscale/hillshade overlay (BE9 overlay endpoint) with an opacity slider; download button per AOI
[   ]  Manning panel: LULC source (NLCD year picker / Esri Sentinel-2), then a compute action that produces the per-AOI class table
[   ]  Editable Manning table (desktop parity): rows = detected land-cover classes with coverage %, columns = Min / Avg / Max roughness, cells editable with numeric validation (0 < n ≤ 1, warn outside typical ranges); column-select for which value rasterizes; per-AOI tables with a "copy to all AOIs" convenience
[   ]  Table edits POST back before rasterization (BE7's round-trip); the applied table is visible after the fact (audit: what n values did this run use?)
[   ]  LULC + Manning raster results render as map overlays with a class legend; downloads per AOI
[   ]  Precheck feedback surfaced BEFORE submit: predicted raster dimensions from AOI × resolution, and the BE10 cap verdict, shown as the user adjusts resolution
[   ]  Error states: failed step shows the failure message from StepRun with a re-run action; partially-failed multi-AOI submits are legible (2 of 3 succeeded)

Implementation Tasks
* DEMStepPanel + ManningStepPanel components on a shared StepPanel pattern (config form → submit → per-AOI progress → results) that FE5/FE6 reuse
* ManningTable component (editable grid, validation, dirty-state tracking)
* Overlay integration in AoiMap (image source + opacity control) via BE9's PNG+bounds endpoint
* Live dimension-precheck readout wired to the BE10 precheck endpoint

Out of Scope
* BCI/BDY/PAR panels (FE5/FE6) · overlay legends beyond LULC classes · raster styling controls beyond opacity · TRITON's constant-friction mode (post-MVP)

—

TASK: BYU CIROH: FIMsim GUI – BCI + BDY Step Panels (incl. Hydrograph Preview) (FIMSIM-FE5)

Description: The boundary-condition and flow-data panels — the steps where FIMsim's hydrology shows. BCI turns the detected river endpoints into LISFLOOD boundary definitions; BDY fetches the event hydrograph from the user's chosen source and previews it before anything is written. The hydrograph preview chart is the panel's centerpiece (desktop parity) and doubles as the user's sanity check that they picked the right event window.

[   ]  BCI panel: upstream and downstream boundary cards anchored to FE3's detected endpoints (shown on the map, highlighted while configuring); boundary type selectors mirroring the desktop's options per end (upstream inflow vs. downstream stage/free), with plain-language descriptions of each choice
[   ]  BCI handles the no-river case gracefully (FE3's empty state): explains that boundary detection failed and what the user can do
[   ]  BCI submit → per-AOI progress on cards → detected boundary segments drawn on the map; .bci + flowlines in the outputs list
[   ]  BDY source picker: NWM retrospective (date-range pickers bounded to the dataset's coverage), NWM forecast (range/date/hour), USGS gage (dropdown of FE3's detected gages with NWIS links), upload CSV/XLSX (client template link + BE6 presign), or premade .bdy passthrough
[   ]  Hydrograph preview chart (echarts, the family charting dep): discharge vs. time for the fetched series, per AOI; peak value + time annotated; sim duration readout (what PAR will inherit)
[   ]  Multi-AOI legibility: per-AOI hydrograph tabs or small-multiples — comparing AOIs' events must not require re-fetching
[   ]  Source-specific validation surfaced before submit: retrospective dates within coverage, forecast horizon limits, uploaded CSV parsed + unit-checked with a clear error listing bad rows
[   ]  BDY submit → .bdy + timeseries CSV in outputs; the chart re-renders from the produced CSV (BE9's timeseries endpoint) so what you see is what was written

Implementation Tasks
* BCIStepPanel + BDYStepPanel on the FE4 StepPanel pattern
* HydrographChart component (echarts-for-react, family versions); series from BE7's preview + BE9's produced-CSV endpoints
* Map interactions: endpoint highlighting during BCI config; boundary-segment layer on completion
* CSV template + client-side pre-parse for fast feedback (authoritative validation stays server-side)

Out of Scope
* PAR + run submission (FIMSIM-FE6) · editing the hydrograph by hand (post-MVP) · TRITON's multi-source .hyg staging UI (post-MVP) · gage data QA beyond what fimcore already does

