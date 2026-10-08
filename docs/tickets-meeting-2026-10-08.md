# Tickets from the 2026-10-08 demo meeting (FIMsim portion)

Cross-check of the meeting-assistant notes + Reshma's own notes (hers win where
they differ) against the living tracker. New tickets below; updates to existing
tickets listed first. FIMsense / FIMbench / FIMeval items are tracked elsewhere.

## Updates to existing tickets
- FIMSIM-FE49 (per-step downloads, #23): REAFFIRMED — asked for a second time;
  build next.
- FIMSIM-FE50 / BE20 (remove the Time limit control): scope is ALL workflows,
  not just LISFLOOD (it was seen on TRITON too — confirm where, the only
  `solver_timeout_s` field is on the LISFLOOD Run step).
- FIMSIM-FE52 (Manning bounds) REVISED by Reshma's note #4/#5: the absolute
  clamp is ~[0.001, 1.0] (NOT Nathan's [0.01, 0.09] from 10-01 — matches what
  the server already enforces); per-class literature [min,max] is a SOFT limit
  for Esri Sentinel-2 AND NLCD on LISFLOOD AND TRITON. Out-of-range row turns
  yellow with ⚠️ plus an info note: "outside the recommended range — this
  will affect your results". BE15 (remove the per-class clamp) is the
  prerequisite and is reaffirmed.
- FIMSIM-FE48: done (model stored on the project); follow-up FE58 below.
- #xi / FE35 (single-AOI revert): REINFORCED — Sagy's position is the online
  app stays one case study at a time; multi-case INPUT preparation was left
  undecided (see Deferred).

## Deferred / scope
- ARC-Curve2Flood web wizard: PAUSED (Reshma #12). BE24 engine sync stays
  merged; the live-run acceptance and the wizard spec resume when Parvaneh
  delivers sample files + a walkthrough (~2 weeks). Her ARC accuracy concern
  (worse than HAND-FIM; discussing with Joseph Gutenson) is another reason to
  wait.
- Multi-case input-data preparation online: NOT decided (Parvaneh for,
  Sagy leaning no / separate add-on app). No ticket.
- After this round: the "Preparing Input Data" portion of FIMsim (details to
  come from Reshma).

—

TASK: BYU CIROH: FIMsim GUI – Hydrograph: Explicit Date Tick Labels (FIMSIM-FE53)

Description: FE43 added a legend and a dated axis TITLE, but the X-axis ticks
still show hours. Reshma wants individual dates written on the axis — as
truncated as needed (e.g. "Oct 05", "Oct 06"), but labelled. Both Flow Data
steps (bdy, thyg) and the Results chart.

[   ]  X-axis ticks are calendar dates (short form), not hour offsets, on bdy/thyg/Results charts
[   ]  Ticks thin out automatically on long windows (no overlapping labels) but never disappear
[   ]  Tooltip still shows the full date-time

Implementation Tasks
- HydrographChart.tsx: time-type xAxis with a date formatter + interval auto;
  keep the parseHyg/.bdy loaders unchanged.

Worst-case estimate: 2 h.

—

TASK: BYU CIROH: FIMsim GUI – Welcome Modal: Single Desktop Link (FIMSIM-FE54)

Description: "desktop FIMsim" is hyperlinked in more than one place in the
welcome modal. Keep the first link only; later mentions become plain text.

[   ]  Exactly one anchor to the desktop app in the modal; other mentions are plain text

Worst-case estimate: 0.5 h.

—

TASK: BYU CIROH: FIMsim GUI – Stepper: Skipped Steps Keep Their Number (FIMSIM-FE55)

Description: The rail marks every step BEFORE the active one with a ✓ purely
by position, so a skipped step (e.g. Run) looks done. A step should show ✓
only when its run succeeded for every AOI; otherwise it keeps its number.
Both models.

[   ]  A step earlier in the rail that was never run shows its number, not ✓
[   ]  A step whose latest run succeeded shows ✓ even when the user has moved past it
[   ]  Project and AOI (non-job steps) are ✓ once a project / at least one AOI exists

Implementation Tasks
- NewSimulation.tsx stepper: derive `done` from the AOIs' step summaries
  (status === 'succeeded' for all AOIs) instead of `i < idx`; pure helper +
  test.

Worst-case estimate: 3 h.

—

TASK: BYU CIROH: FIMsim GUI – Run Step: Confirm Before Proceeding Without a Run (FIMSIM-FE56)

Description: Simulations take 3–4 h, so users may click Next past the Run
step. Agreed in the meeting: (a) move the "Run simulation" button next to
the Next button; (b) when the user leaves the Run step with no successful run,
show a confirmation dialog; (c) on the Results page, make the existing "no
simulation was run" notice stand out. Reshma's wording for the dialog: the
user is choosing to proceed without running the model — are they okay with
that? Buttons (short forms): "Proceed without running" / "Stay and run".

[   ]  Run simulation button sits beside Next on the Run step
[   ]  Clicking Next with no succeeded run opens a modal dialog with the two options; "Stay and run" keeps the user on Run
[   ]  Results page's no-run notice is visually prominent (warning style) when no run succeeded
[   ]  Dialog does not appear when a run has succeeded

Implementation Tasks
- NewSimulation.tsx: Next-button handler checks the run step's status;
  reusable ConfirmDialog component; ResultsStep notice gets a warning style.

Out of Scope
- TRITON (no Run step on the portal).

Worst-case estimate: 5 h.

—

TASK: BYU CIROH: FIMsim GUI – Header Model Badge Next to the Logo (FIMSIM-FE58)

Description: Parvaneh lost track of which model she was in; the eyebrow badge
on the step card was missed. Add a model badge beside the FIMsim logo/title
in the header (like the alpha badge) whenever the wizard is past the Project
step, showing LISFLOOD-FP or TRITON (or the project's model generally).

[   ]  Header shows a model badge on /new/<id>… routes; none on /new, /docs, lists
[   ]  Badge text/colour matches the step-card badge (deck-only purple for TRITON)

Implementation Tasks
- Header.tsx reads the route params (projectId + model via the loaded project
  or slug) — or NewSimulation publishes the active model through a tiny
  context; render beside wk-alpha-badge.

Worst-case estimate: 3 h.

—

TASK: BYU CIROH: FIMsim GUI – Results Step: "Input Data" and "Results" Tabs (FIMSIM-FE59)

Description: Split the Results step into two tabs for both models: "Input
Data" = every step's output files for download (what the step shows today);
"Results" = the simulation products (flood overlay, max-depth files,
snapshots) when a run exists, otherwise the prominent no-run notice (FE56).

[   ]  Two tabs on the Results step; Input Data lists per-step files with the FE30 select/zip download
[   ]  Results tab shows the overlay + run files for LISFLOOD; for TRITON it shows the deck download and says the model runs off-portal
[   ]  No-run state on the Results tab uses the FE56 prominent notice

Implementation Tasks
- ResultsStep.tsx: tab state + split the current table by step (run vs
  input steps); reuse outputsMeta groupings.

Worst-case estimate: 6 h.

—

## Non-dev to-dos (Reshma)
- Upload LISFLOOD-FP + TRITON results for AOI_1 and AOI_2 to Box for
  Parvaneh's step-by-step comparison — she wants the per-timestep DEPTH
  series (~200 steps), not just max depth. The LISFLOOD Run step already has
  "Depth time series" (keep_snapshots) → depth_snapshots.zip. TRITON cannot
  produce depth results on the portal (deck only) — only its deck can be shared.
- FIMbench: rename the tier-4 label. FIMsense: none for Reshma.

## Waiting on Parvaneh
- ARC-Curve2Flood sample data + full walkthrough (~2 weeks); a 4th GitHub
  test case for ARC; CRS-identification logic for user shapefiles; LULC
  Manning min/max values (feeds FE52); remaining prep-step screenshots.
