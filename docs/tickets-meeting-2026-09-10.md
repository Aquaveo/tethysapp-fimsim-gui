# FIMsim GUI — tickets from the testing/demo meeting (Sep 10, 2026)

Reshma's FIMsim/TRITON action items from the joint testing session (Reshma,
Parvaneh, Dipsikha, Dinuke). FIMeval items from the same meeting live on the
FIMeval board.

Waiting on others: Parvaneh owes example/test datasets + a user-CSV sample
(two columns, specific headers) + valid land-cover year ranges + the
Manning-ranges walkthrough; Dinuke owes the Google Earth Engine reference
link; Gio owes deployment status (folds into FIMSIM-OPS1).

---

TASK: BYU CIROH: FIMsim GUI – Remove the Friction Step's Grid-Resolution Input (FIMSIM-FE22)

Description: Team decision — grid size is established at the Terrain (DEM) step, so asking again on the land-cover/friction step is redundant and invites mismatches. Remove the input and derive it from the Terrain run.

[   ]  'Grid resolution (m)' field removed from the TRITON Friction form (the only step that exposes it)
[   ]  Backend derives dem_res_m for the friction job from the AOI's current tdem run config (reject with a clear reason if Terrain hasn't run — the requires guard already enforces order)
[   ]  Validation updated; regression test pins the derivation

🚦 Status: Not started

—

TASK: BYU CIROH: FIMsim GUI – Boundary Value Field: Manual Entry Bug + Info Tooltip (FIMSIM-FE23)

Description: During testing, manually typing a boundary value didn't work reliably. Likely the controlled number input fighting intermediate decimal states (typing "0.0001" passes through "0." which coerces oddly). Also decided: an information tooltip next to the boundary-value selection pointing at the docs (TRITON defaults to normal slope 0.001; three strict options — no confluence water-level type).

[   ]  Boundary value (and other number fields) accept manual decimal entry naturally — keep the raw string in form state, coerce on submit
[   ]  Info tooltip beside the boundary-value/type controls linking to the docs' boundary sections (LISFLOOD bci + TRITON tbc)
[   ]  Docs boundary sections mention the desktop-verified guidance: boundaries must sit at the domain edge (pooling/"artificial sea" failure mode otherwise)

🚦 Status: Not started

—

TASK: BYU CIROH: FIMsim GUI – Info Icons on Every Setting (FIMSIM-FE24)

Description: Dinuke's recommendation, agreed: each configuration field gets a tooltip/info icon explaining what it does, linking to documentation where useful (e.g., model runtime steps). We already carry per-field help text under some inputs; upgrade to a consistent ⓘ affordance across every field on every step.

[   ]  FieldSpec grows an optional docs anchor; StepPanel renders an ⓘ icon with the help text (hover/focus accessible) instead of/alongside the inline help line
[   ]  Every field on every step (both models) has help copy — audit and fill the gaps
[   ]  Icons link into the relevant Docs section anchor where one exists

🚦 Status: Not started

—

TASK: BYU CIROH: FIMsim GUI – Date-Only Event Window (Default 12 a.m.) (FIMSIM-FE25)

Description: Decision — users shouldn't be forced to pick times for hydraulic model dates. Replace the datetime inputs with date pickers; start/end default to 00:00 when no time is given.

[   ]  Flow Data / Hydrograph start+end become date inputs; submitted as T00:00
[   ]  Backend already accepts date-only ISO (datetime.fromisoformat) — pin with a test
[   ]  Docs/tutorial copy updated (dates, not datetimes)

🚦 Status: Not started

—

TASK: BYU CIROH: FIMsim GUI – Fix the Flood-Layer Opacity Slider (FIMSIM-FE26)

Description: Testing found the Results opacity slider doesn't visibly change the flood layer. The map wiring (AoiMap overlay effect → setPaintProperty) looks right on paper, so this needs live debugging — possibly the effect ordering or the layer id mismatch after the overlay re-adds.

[   ]  Reproduce with a wet run; fix so the slider updates raster-opacity live
[   ]  Headless-browser regression check (probe the paint property after moving the slider)

🚦 Status: Not started

—

TASK: BYU CIROH: FIMsim GUI – Flood-Map Time-Step Progression Viewer (FIMSIM-FE27)

Description: Show the flood evolving, not just the max-depth map: ~10 representative time steps (of the ~100–240 saved) with a toggle/scrubber, GEE-style (Dinuke sends a reference link), alongside the opacity slider. Dipsikha's fallback — max depth + extent — is what we show today, so this is additive.

[   ]  Run step (keep_snapshots or a lighter server-side variant) produces ~10 evenly-spaced depth overlays (PNG + bounds), not just max_depth
[   ]  Results gains a time scrubber/toggle over those frames
[   ]  Kept optional/off by default — snapshot rendering costs storage and compute (portal fair-use)

🚦 Status: Not started (design input: Dinuke's GEE link)

—

TASK: BYU CIROH: FIMsim GUI – Unclamp Manning's n Edits (Sensitivity Analyses) (FIMSIM-BE15)

Description: Parvaneh's call — the min/max clamp on per-class Manning edits blocks legitimate sensitivity analyses and broader categorization. Keep the field editable with the literature range as guidance, not enforcement; the info note recommends the average value.

[   ]  ManningTable stops clamping edits to [min, max]; range shown as guidance with a note recommending the average
[   ]  Server validation loosened to a sanity band only (e.g. 0.001–5) with a clear reason on rejection
[   ]  Same treatment for the fixed-n fields (manning + tfric fpfric_val)
[   ]  Tests updated (clamp removal + new band)

🚦 Status: Not started

—

TASK: BYU CIROH: FIMsim GUI – Land-Cover Year Dropdown (Valid Ranges Only) (FIMSIM-FE28)

Description: Testing question ("what if someone types 1918 for Sentinel-2?") — agreed the year should be a dropdown restricted to actually-available vintages. Parvaneh is confirming the exact valid ranges per source (Esri Sentinel-2 vs NLCD).

[   ]  Year becomes a select whose options depend on the chosen land-cover source (both manning and tfric)
[   ]  Ranges per Parvaneh (interim: Esri 2017–2023, NLCD published years) — server validation matches
[   ]  Docs data-sources table lists the vintages

Notes: BLOCKED on Parvaneh's confirmed year ranges (interim values can ship).

🚦 Status: Blocked (waiting on Parvaneh; interim doable)

—

## Rolled into existing tickets / no new ticket

* **[Reshma] Confirm Live Status (talk to Gio)** → already FIMSIM-OPS1, whose
  blocker was corrected to Gio on 2026-09-10.
* **USGS 1956–57 test error** — that was the 366-day window guard working as
  designed (Parvaneh confirmed the underlying data limitation); consider a
  friendlier message mentioning the interval/duration trade-off when FE24's
  copy pass happens.
* **Docs guidance from Parvaneh's testing war stories** (fold into FE23/FE24
  copy): hydrograph should include 2–3 days of model spin-up before the flood;
  incomplete hydrographs need a longer duration; boundaries at the domain edge.
* **User-defined CSV hydrograph upload** — desktop has it, web doesn't;
  becomes a ticket once Parvaneh's sample CSV (two columns, specific headers)
  arrives.
