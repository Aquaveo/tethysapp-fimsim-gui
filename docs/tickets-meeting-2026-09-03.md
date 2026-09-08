# FIMsim GUI — tickets from the demo meeting (Sep 3, 2026)

Reshma's action items from the FIMsim demo (attendees: Reshma, Parvaneh,
Dipsikha, Nathan; Gio and Dr. Cohen absent). FIMeval items from the same
meeting (box plots for additional scores, bootstrap medians, multi-raster
question to Dr. Cohen) are Dipsikha's and are not ticketed here.

Blockers to watch: three tickets wait on inputs Parvaneh owes (unlisted-class
n value, LULC-percentage code snippet, official 10 m DEM product name,
forecast-cycle clarification from the client).

---

TASK: BYU CIROH: FIMsim GUI – Docs Page Layout: Two-Column, Tighter Whitespace (FIMSIM-FE16)

Description: Meeting feedback: the documentation page carries excess white space. Reorganize the layout — consider a two-column format — so the parameter reference and tutorials read denser without losing the FIM-family look.

[   ]  Excess vertical/horizontal white space removed (notably around the TOC rail and section headings)
[   ]  Two-column layout evaluated and applied where it helps (e.g., parameter tables / data-sources side by side); single column retained where columns would hurt readability
[   ]  Mobile behavior unchanged (columns collapse below the existing 820 px breakpoint)

Out of Scope
* New documentation content (the Sep rewrite already covers the manual); naming corrections (FIMSIM-FE19)

🚦 Status: Not started

—

TASK: BYU CIROH: FIMsim GUI – Per-Step Overview Panels (Desktop Parity) (FIMSIM-FE17)

Description: Parvaneh demonstrated how the desktop version shows users detailed context at every step (AOI details, detected river data) so errors are caught where they arise. Agreed as the main pre-deployment feature work — and Parvaneh noted the same pattern will streamline the later TRITON work.

[   ]  Each wizard step shows a compact overview of the state it consumes: AOI (area, working CRS, states/HUCs), Terrain (source, resolution, grid size), Boundaries (detected main river + inflow/outflow locations), Flow Data (source, window, peak), Settings (solver, sim time)
[   ]  Boundary-condition step surfaces the detected upstream/downstream points prominently (the desktop's "check the markers before building the model" guidance)
[   ]  Data comes from existing ctx/StepRun fields — no new fimcore calls
[   ]  Step overviews reviewed against Parvaneh's desktop screens for parity

Out of Scope
* LULC coverage percentages (FIMSIM-BE12 — blocked on Parvaneh's snippet)

🚦 Status: Not started

—

TASK: BYU CIROH: FIMsim GUI – Alpha Badge + Mode URL Slugs (FIMSIM-FE18)

Description: Deployment decision: the portal version ships clearly labeled as the lightweight alpha (Dr. Cohen wants the web apps kept "light"; the FIMeval alpha uses the same convention). Parvaneh also proposed URL slugs distinguishing app modes (e.g. /fimsim/lisflood-fp) so users always know which model they're driving.

[   ]  "Alpha" badge in the header chrome (FIMeval welcome-modal callout pattern for the copy: lightweight version, link to the desktop app for the full feature set)
[   ]  Welcome modal mentions alpha status alongside the existing limits
[   ]  Mode slug in the URL: the wizard lives under a model-scoped path (LISFLOOD-FP today) so future TRITON/HAND modes get their own slugs without breaking links

🚦 Status: Not started

—

TASK: BYU CIROH: FIMsim GUI – LULC Per-Class Coverage Percentages (FIMSIM-BE12)

Description: Show the percentage of each land-cover class inside the AOI (pixel-count based) on the Roughness step, matching the desktop. Parvaneh is sharing the exact calculation snippet so web and desktop agree.

[   ]  Parvaneh's snippet received and integrated in fimcore or the manning job (single source of truth)
[   ]  Roughness step (and the Manning table) shows per-class coverage % after the step runs
[   ]  Percentages match the desktop for the Neuse test AOI

Notes: BLOCKED on Parvaneh's code snippet.

🚦 Status: Blocked (waiting on Parvaneh)

—

TASK: BYU CIROH: FIMsim GUI – Unlisted Land-Cover Class Default n (FIMSIM-BE13)

Description: The demo surfaced a discrepancy for land-cover classes without a Manning's n entry: the app discussion mentioned 0.045 while Parvaneh typically uses 0.035. She is verifying the correct value.

[   ]  Confirmed value from Parvaneh applied as the unlisted-class default (fimcore table or web override — wherever the desktop keeps it, for parity)
[   ]  Manning table footnote states the unlisted-class default so users aren't surprised
[   ]  Validation/regression test pins the value

Notes: BLOCKED on Parvaneh's confirmation (0.035 vs 0.045).

🚦 Status: Blocked (waiting on Parvaneh)

—

TASK: BYU CIROH: FIMsim GUI – Data-Source Naming + Forecast-Cycle Explanations (FIMSIM-FE19)

Description: Two accuracy items for the interface and docs: (1) use the official product name for the "10 m elevation data" (Parvaneh providing; likely the 3DEP 1/3 arc-second product name); (2) explain the NWM forecast cycle options properly — the demo found short-range cycle options not updating as expected, and Parvaneh is asking the client what the cycles mean.

[   ]  Official 10 m DEM product name used in the Terrain step, welcome modal, and docs
[   ]  Forecast cycle options explained in the Flow Data step help + docs once Parvaneh reports back
[   ]  Investigate the short-range cycle options not updating (bug or expectation?) and fix or document

Notes: BLOCKED on Parvaneh (product name; client answer on cycles).

🚦 Status: Blocked (waiting on Parvaneh)

—

TASK: BYU CIROH: FIMsim GUI – Deploy the Alpha for User Testing (FIMSIM-OPS1)

Description: Deploy the current version to the Tethys portal so user testing can start. Parvaneh will evaluate the deployment and specifically verify the boundary-condition step (her area of concern; the BF2 inflow-snap fix is directly relevant to her check).

[   ]  FE16–FE18 + the tests/hardening PR merged into the deployed build (per the meeting: step overviews + feature improvements go in before official deployment)
[   ]  Deployment path settled with Nathan (portal target, storage + Dask + LISFLOOD binary provisioning, maintenance cron with Gio)
[   ]  App live on the portal with the alpha badge; Parvaneh notified to start testing (boundary-condition verification pass)

🚦 Status: Not started (deployment path pending Nathan)

—

## Already satisfied (no ticket)

* **[Reshma] Enhance File Details** ("file size information and download
  options... clear labeling for each file in the output section") — shipped
  Sep 2 in the Results overhaul: per-file table with step / name / description
  / size / download plus a per-AOI Download-All zip, deduplicated (see
  tickets-bugfixes.md, FIMSIM-BF6). Parvaneh's testing pass (FIMSIM-OPS1)
  doubles as acceptance.
