# ARC-Curve2Flood on the web — tickets (2026-10-08)

Context: Reshma asked for the ARC-Curve2Flood wizard on the portal (full run,
sample AOI). Parvaneh's desktop (pnikrou/FIMsim @ 2fc8f89) no longer calls ARC
and Curve2Flood directly: it writes a NenCarta watershed JSON and shells out to
NenCarta's `flood-mapping` CLI, which runs ARC → Curve2Flood, downloads ESA
WorldCover itself and fetches its own streamflow (GEOGLOWS, or NWM with a CIROH
key). Its wizard is Project → AOI → DEM → Flowline → Streamflow → Run (no Land
Cover step). fimcore still carries the OLD direct-call pipeline, so the engine
must be synced before any web wizard work. This file holds the sync ticket;
the wizard tickets follow once the design spec is approved.

—

TASK: BYU CIROH: FIMsim GUI – fimcore: Sync the ARC-Curve2Flood Path to the Desktop's NenCarta Design (FIMSIM-BE24)

Description: fimcore's ARC modules were extracted from an older desktop `core/`
that called ARC and Curve2Flood in-process and had a Manning step. The desktop
has since moved ARC-Curve2Flood onto NenCarta (jlgutenson/nencarta 0.3.0): the
Run step builds `{"watersheds": [...]}` entries, writes `nencarta.json` and runs
`flood-mapping json <file> --serial` as a subprocess; the Flowline step gained
GEOGLOWS v2 as a source; the Streamflow step became NenCarta streamflow keys
(GEOGLOWS / NWM short-medium-long range, retrospective or forecast, snapshot or
duration with one map per timestep); bathymetry defaults changed on the NenCarta
author's advice (disable_bathymetry=True). Bring fimcore's ARC path up to the
desktop at 2fc8f89, Qt-free, so the web Run step can drive NenCarta exactly as
the desktop does. Engine-only: no web app changes in this ticket.

[   ]  fimcore ships the desktop's ARC path: arc_orchestrate.py (+562 lines), arc_flowline.py (+65), arc_run.py (2) and the new modules nencarta_run.py, nwm_flows.py, geoglows_streams.py, arc_flowseries.py, arc_reproject.py, with `core.` → `fimcore.` rewritten
[   ]  api_keys.py is ported WITHOUT PyQt6/QSettings: `load_nwm_api_key()` reads the FIMSIM_NWM_API_KEY environment variable (set by the web app's job runner); save/clear are desktop-only and omitted
[   ]  `importlib.import_module` of every synced module succeeds in a Qt-free environment (test asserts no PyQt in the import closure)
[   ]  `prepare_dem` accepts `overwrite_dem` (the ARC orchestrator passes it); the rest of dem.py's 444-line drift stays out of scope
[   ]  Unit tests: nencarta_run.build_watershed() produces the four required keys + the desktop defaults (disable_bathymetry True, mapper Kernel Weighted); write_nencarta_json round-trips; find_flood_maps() finds `*FloodMap*.tif` under a fake output dir; run_flood_mapping() raises NenCartaError when the CLI is absent
[   ]  pyproject `[arc]` extra lists nencarta (git), geoglows, progress alongside arc + curve2flood; README's ARC line says NenCarta
[   ]  One live run of the Neuse test AOI (desktop test_case/AOI_1_Neuse, GEOGLOWS retrospective, snapshot) completes on this machine from a plain Python session using fimcore only, producing a FloodMap GeoTIFF — logged in the PR

Implementation Tasks
- Copy the nine desktop files listed above from ~/random/FIMsim/core into
  fimcore/src/fimcore; rewrite `core.` imports; keep lazy third-party imports
  (fimcore rule: importing fimcore reads nothing).
- api_keys.py: replace the QSettings backend with an env-var read; keep
  check_nwm_api_key() (requests) for the app's future settings page.
- dem.py: add the `overwrite_dem` keyword (default True = desktop behaviour,
  which also matches 651cea2 "stop deleting the raw downloaded tiles") without
  pulling dem_sources; leave LISFLOOD/TRITON DEM behaviour untouched.
- Drop the now-dead ARC Manning path from fimcore's ARC orchestrator only if
  the desktop dropped it (it did: arc_manning stays as a module for
  mannings_text_file but is no longer a wizard step).
- Environment: `pip install git+…/automated-rating-curve git+…/Curve2Flood
  git+…/nencarta geoglows progress` into the Tethys env the workers share;
  confirm `flood-mapping --help` runs headless (NenCarta imports PyQt5 at load —
  expect to need QT_QPA_PLATFORM=offscreen and/or libGL on a bare worker).
  Missing today: geoglows, whitebox, pipefunc, progress, polars, fastparquet,
  geojson, PyQt5.
- Tests as listed; run the full fimcore suite.

Out of Scope
- The web wizard, job types, field specs, Results overlay (next tickets, after
  the design spec).
- Syncing dem.py / aoi_info.py / nlcd.py / hand.py drift beyond `overwrite_dem`
  (separate parity ticket; see also the Sentinel-2 year parity item #19).
- NWM streamflow on the web (needs a CIROH key as an app setting) — first web
  slice is GEOGLOWS retrospective, snapshot mode.

Notes: the desktop's `validate_with_nencarta()` pre-flight is documented as
never fatal (98ff8c1) — keep that contract. NenCarta writes its outputs under
<AOI>/nencarta-output/<name>/; the web Run step will collect from there.

Worst-case estimate: 12 h (sync 4 h, tests 3 h, environment + live run 5 h).

—

Follow-on tickets (filed after the design spec is approved): web ARC job
types (adem/aflow/aq/arun) + collect/overlay (BE), ARC wizard steps + fields +
polygon AOIs + sample AOI (FE), NWM API key app setting (BE), ARC docs page (FE).
