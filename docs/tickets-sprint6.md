# FIMsim GUI — Sprint 6 tickets (FE6–FE9)

---

TASK: BYU CIROH: FIMsim GUI – PAR Step + Run Submission UI (FIMSIM-FE6)

Description: The last configuration panel and the moment of commitment. PAR exposes LISFLOOD-FP's solver settings with the desktop's defaults (the point is that a non-modeler can leave everything alone), and the Run step is the pre-flight review: what's about to be simulated, for which AOIs, at what predicted cost — then one button that hands everything to BE8.

[   ]  PAR panel: solver mode, timestep, save interval, SGC toggle, checkpoint, overpass, free-text extra keywords — desktop defaults pre-filled, every field with a one-line plain-language description (a non-modeler should be able to leave defaults and proceed)
[   ]  Sim duration displayed read-only, inherited from the BDY step's hydrograph (the desktop wires these together; the web must too)
[   ]  PAR submit → model.par per AOI in outputs; step chip updates on the FE3 cards
[   ]  Run step pre-flight per AOI: readiness checklist (every prerequisite step's chip green; missing steps named with jump-links), predicted grid size, sim duration, and the BE10 runtime-budget verdict
[   ]  "Run simulation" submits BE8 jobs for all ready AOIs (per-AOI fan-out); AOIs that aren't ready are listed, not silently skipped
[   ]  Post-submit, the wizard advances to the Running step (FE7) automatically
[   ]  Free-text extra keywords passed through verbatim with a warning that they're unvalidated (desktop parity — this is the expert escape hatch)

Implementation Tasks
* PARStepPanel on the FE4 StepPanel pattern (forms + defaults from BE7's GET schema endpoint)
* RunStep component: readiness aggregation from StepRun statuses, precheck readouts from BE10, submit action → BE8
* Wire sim-duration from the BDY step's produced series metadata

Out of Scope
* Live run progress (FIMSIM-FE7) · results display (FIMSIM-FE8) · TRITON's .cfg panel (post-MVP) · PAR templates/presets library (post-MVP)

—

TASK: BYU CIROH: FIMsim GUI – Running Step + Staged Progress Polling (FIMSIM-FE7)

Description: What the user watches for the minutes-to-tens-of-minutes a simulation takes. One screen that makes N concurrent per-AOI jobs legible: staged progress per AOI (queued → downloading → processing → simulating → uploading → done), a live sim-time bar for the solver phase (BE8 emits percent-of-duration), and failure states that say what actually went wrong. No bare spinners (FIMeval's FE13 lesson: a spinner and a job id is not feedback).

[   ]  Per-AOI progress rows: stage label + progress bar fed by StepRun's structured progress events (BE5 contract); the solver phase shows simulated-time percent, data-prep phases show their [i/n] counters
[   ]  Long-running jobs remain clearly alive (last-event timestamp shown; a stalled job says "no update for Xm" rather than freezing ambiguously)
[   ]  Failure state per AOI: the StepRun failure message and the solver-log tail (BE8 attaches it) in a collapsible block — plus a re-run action for just the failed AOIs
[   ]  Cancel per AOI and cancel-all, with confirm; cancelled rows render distinctly from failed
[   ]  Overall project banner: n running / n done / n failed; the page is safe to leave and return to (state reconstructs from polling, nothing lives only in memory)
[   ]  Polling via the shared useProjectStatus hook (FE3) — one interval per project, backing off when the tab is hidden
[   ]  Completion: all-done transitions offer "View results" (FE8); mixed outcomes summarize honestly (2 succeeded, 1 failed)

Implementation Tasks
* RunningStep component: per-AOI ProgressRow (stage machine rendering the BE5 event shape), log-tail collapsible, cancel actions → BE5 cancel endpoints
* Extend useProjectStatus with event-stream fields + hidden-tab backoff
* Empty state (nothing running → link back to Run step)

Out of Scope
* Websocket push (polling is the MVP; the hook is the later swap point) · run detail page à la FIMeval's RunDetail (FE9 links suffice for MVP) · progress for TRITON/ARC/HAND-FIM runs (post-MVP)

—

TASK: BYU CIROH: FIMsim GUI – Results Step: Flood-Map Overlay + Downloads (FIMSIM-FE8)

Description: The payoff screen — the reason the whole pipeline exists. The simulated flood renders on the map over the AOI, togglable between max-extent and max-depth views, with every produced file one click away. This is also the screen that gets shown in demos and FIMecosystem meetings, so it must read instantly: water, on a map, where the model says it goes.

[   ]  Flood-map overlay per AOI from BE9's PNG+bounds endpoint: max-depth (color ramp + compact legend with depth values) and wet/dry extent (single blue) as a toggle; opacity slider; renders over both basemaps legibly
[   ]  Multi-AOI: results for every completed AOI shown together; selecting an AOI's card zooms to it (FE3 behavior carries through)
[   ]  Summary strip per AOI: max depth, inundated area km², sim duration, solver wall-time — computed once server-side (BE9), displayed with units
[   ]  Downloads: per-file list (name/size/type) with presigned links; per-step zip and whole-project zip buttons (BE9); the LISFLOOD deck downloadable separately for take-it-to-your-own-solver users
[   ]  Hydrograph recap: the BDY chart (FE5's component, reused) next to the map so event and outcome read together
[   ]  Failed/partial projects: failed AOIs listed with links back to FE7's failure detail; results shown for whatever succeeded
[   ]  Deep-linkable: /new/<project_id> restored at the Results step shows results without replaying the wizard

Implementation Tasks
* ResultsStep component: overlay controls (view toggle, opacity), legend, summary strip, downloads list
* Overlay layering in AoiMap (reuses FE4's image-source mechanics; z-order over DEM/LULC overlays if those are still toggled on)
* Summary-stats display from BE9's metadata; graceful absence when stats aren't computed yet

Out of Scope
* COG tile-server rendering + time-series animation (v7 roadmap) · side-by-side run comparison (post-MVP) · pushing results into FIMeval (pending the time-step alignment discussion) · print/report export

—

TASK: BYU CIROH: FIMsim GUI – Project/Job History List (FIMSIM-FE9)

Description: Make the Simulations sidebar real. The placeholder becomes the persistent list of the user's projects with live status — the workspace's memory, and the way users re-enter yesterday's work. Mirrors FIMeval's RunsList role in the family layout (ours lives inside the nav per stakeholder feedback).

[   ]  Sidebar lists the user's projects, newest first: name, created date, AOI count, and a rolled-up status dot (running / all-done / has-failures / draft)
[   ]  Running projects tick live (shared polling hook; only poll projects with active jobs)
[   ]  Clicking a project opens it in the wizard at its furthest-configured step (state reconstructed from StepRuns — the resume experience)
[   ]  The active project is highlighted; "＋ New Simulation" behaves correctly mid-wizard (confirm before abandoning an unsaved draft, or just navigate — decide and document)
[   ]  Delete from the sidebar with confirm (cascades per BE6's delete semantics; storage cleanup noted as BE10's retention concern)
[   ]  Empty state preserved for new users (current copy stays)
[   ]  List stays legible at 20+ projects: scroll within the sidebar section, no layout breakage at long names

Implementation Tasks
* SimulationsList: fetch + render from BE6's project list endpoint (status rollup server-side, one query — no N+1 polling)
* Furthest-step resolution helper (max completed StepRun per project → wizard route)
* Selection/highlight sync with the wizard's project id route param

Out of Scope
* Per-run detail pages (FE7's failure detail covers MVP) · search/filter/sort beyond newest-first (post-MVP) · sharing projects between users (post-MVP; per-user isolation is the MVP rule) · admin views

