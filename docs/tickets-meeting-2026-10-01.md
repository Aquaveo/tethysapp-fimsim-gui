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
- FIMSIM-BE15 (unclamp Manning's n): the per-class [min, max] stops being a
  CLAMP. Replace BE15's wide sanity band (0.001–5) with a HARD global clamp of
  [0.01, 0.09] — the only enforced limit. The per-class literature range becomes
  a soft WARNING threshold (see FE52), not enforcement.

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

TASK: BYU CIROH: FIMsim GUI – Manning's n: Global Clamp + Per-Class Literature Warnings (FIMSIM-FE52)

Description: Nathan's compromise in the 2026-10-01 review on Manning's n limits.
TWO tiers, don't conflate them:
  1. HARD CLAMP (absolute, global): every n is constrained to [0.01, 0.09]. The
     field won't accept a value outside it and the server rejects outside it.
     This is the only enforced limit and gives sensitivity-analysis headroom
     (Sagy's wide band).
  2. SOFT WARNING (per class, literature): each land-cover class already carries
     its own recommended [min, max] in the Manning tables (fimcore
     NLCD_MANNING / SENTINEL2_MANNING — e.g. a class whose recommended band is
     [0.025, 0.035]). A value INSIDE [0.01, 0.09] but OUTSIDE that class's
     recommended band flags a non-blocking warning; the user can confirm and
     proceed. The recommended min / avg / max stay visible as guidance.
So per-class values are back as WARNING thresholds, not clamps. Builds on BE15
(which stops the per-class clamp); FE52 adds the hard global clamp + the warning.

[   ]  n is hard-clamped to [0.01, 0.09] — a value outside cannot be entered or submitted (field constraint + server rejection with a clear reason)
[   ]  Within [0.01, 0.09], a value outside the row's per-class recommended [min, max] shows a visible, non-blocking warning naming the recommended range; submission still allowed (confirm + proceed)
[   ]  The per-class recommended min / avg / max remain visible as guidance (BE15)
[   ]  Fixed-n fields (manning + tfric fpfric_val): hard-clamped to [0.01, 0.09]; no per-class warning (no land-cover context) — confirm with Reshma whether a generic typical-range advisory is wanted there
[   ]  Tests: in-band (within class range) = no warning; within clamp but outside class range = warning + still submittable; outside [0.01, 0.09] = rejected

Implementation Tasks
- Constants: a shared HARD clamp [0.01, 0.09] (frontend input bounds + server band).
- ManningTable: per-ROW recommended range read from the class table; warn when
  the entered value is outside that row's range but inside the clamp. Style the
  warning as advisory (badge/text), never disabled.
- Server validation: tighten the Manning sanity band to [0.01, 0.09] (replaces
  BE15's 0.001–5), same band for the fixed-n fields.
- Keep submit enabled through warnings; only the hard clamp blocks.

Out of Scope
- Removing the per-class CLAMP (that is BE15; FE52 assumes it's gone).
- Per-class min/max as an enforced limit (explicitly rejected — it's a warning).

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
