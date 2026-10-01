# FIMsim GUI — tickets from the 2026-10-01 meeting

Cross-checked against the existing task list (feedback-2026-09-22, bugs-2026-10-01,
meeting-2026-09-24). Most action items were already tracked or done. Two
genuinely new, Reshma-owned FIMsim tasks came out of this meeting.

## Updates to existing tickets (not new)
- FIMSIM-BE20 / FIMSIM-FE50 (remove time-limit control): decision firmed —
  delete the user-facing "time limit" field; set a backend default of 5–6 h,
  adjustable via a Tethys admin (custom) setting; keep the AOI-area cap as the
  front-line resource guard. (Context: a <1000 km² run is ~3–4 h on one GPU, so
  the old hard-coded 3600 s killed runs early.)
- FIMSIM-BE22 (Flow Data CSV upload): required CSV format confirmed — first
  column header `time_hours`, second column header `discharge_cms`. Parvaneh is
  posting screenshots/spec on GitHub.
- FIMSIM-SCOPE1 (FIMserve integration): prioritized next after FIMbench; goal is
  a unified app version; Nathan coordinates with Dan (BYU); ahead of FIMbox.
- FIMSIM-BE15 (unclamp Manning's n): reframe the guidance band as a single
  GLOBAL reasonable range (≈0.01–0.09) rather than per-category min/max. Pairs
  with the new FE52 warning-flag UX below.

—

TASK: BYU CIROH: FIMsim GUI – Resolution Tooltip: Note Coarser Grids Are Resampled (FIMSIM-FE51)

Description: Sagy's call in the 2026-10-01 review — the DEM resolution tooltip
should state explicitly that the coarser options (30 m, 90 m) are RESAMPLED from
the 10 m USGS 3DEP source, not native 30 m / 90 m downloads, to prevent users
assuming they are fetching a different native product. Copy-only; the Terrain
step body and welcome modal already say this, but the field tooltip does not.

[   ]  The DEM resolution field tooltip (Terrain step) states coarser options are resampled from the 10 m 3DEP source
[   ]  The same tooltip on the Land Cover step's resolution field carries the same note (shared copy)
[   ]  No wording regression: still conveys 10 m default, coarser = faster, finer than 10 m → desktop

Implementation Tasks
- stepFields.ts: append the resampling note to the `dem_res_m` `help` string
  (appears on both the `dem` and `manning` field groups — keep them identical).
- Rebuild the frontend bundle; eyeball the tooltip on both steps.

Out of Scope
- The Terrain step body / welcome modal copy (already done, 2026-09-03).

Worst-case estimate: 1 h.

—

TASK: BYU CIROH: FIMsim GUI – Manning's n Literature-Range Warning Flags (FIMSIM-FE52)

Description: Nathan's compromise in the 2026-10-01 review on Manning's n limits —
rather than hard per-category clamps (which Sagy noted would block sensitivity
analyses), show a non-blocking WARNING when an entered n falls outside a global
reasonable range / literature value, while still letting the user confirm and
proceed. Builds on BE15 (which removes the hard clamp); this adds the warning
UX. Server keeps only a wide sanity band (BE15), so the warning is advisory.

[   ]  Entering an n outside the global reasonable range (≈0.01–0.09) flags a visible, non-blocking warning on that field/row
[   ]  The warning names the typical/literature range and does NOT prevent submission — the user can confirm and proceed
[   ]  Applies to the editable Manning table rows AND the fixed-n fields (manning + tfric fpfric_val)
[   ]  The reasonable range is a single shared constant (not per-category), easy to adjust
[   ]  Tests cover: in-range = no warning; out-of-range = warning + still submittable

Implementation Tasks
- Define a shared `[MIN, MAX]` reasonable-range constant (frontend; mirror any
  server sanity band from BE15).
- ManningTable / fixed-n fields: render a warning badge/text when a value is
  outside the range; style as advisory, never disabled/blocked.
- Keep submit enabled; the band is guidance only.

Out of Scope
- Removing the hard clamp and loosening server validation (that is BE15).
- Per-category min/max enforcement (explicitly rejected in the meeting).

Worst-case estimate: 5 h.

—

## Candidates (await Reshma's call before ticketing)
- USGS gauge CONTEXTUAL LAYER on the map (~3,000+ points, toggleable, off by
  default). Assigned to Dipsikha for FIMbench; could be mirrored onto FIMsim's
  map. FIMsim already detects per-AOI gages — this is a different, global layer.
- EPSG:26914 / projection-optimality investigation ("the group"). Determine
  whether FIMsim's per-AOI UTM choice is optimal for the platform. Vague scope.
- Public documentation site: the desktop help points to a local path; the group
  suggested generating a public GitHub HTML docs page from Parvaneh's materials.
  Would give FIMsim's "Documentation" link a real target. Cross-team.
- Demo video embed on the FIMsim landing page (await Parvaneh's voice-over video).
- Hydrograph gap handling: don't draw straight lines across missing USGS data
  intervals (show breaks/gaps). Diagnostic only in the meeting, unassigned.
- Shapefile upload errors on Parvaneh's polygon-plus-shapefile combinations —
  reproduce with her exact files; may overlap #xi (remove multi-AOI picker) and
  the known corrupt-zip / 3D-coordinate issues.
