"""FIMSIM-BE7: the five LISFLOOD-FP step job types.

Defaults mirror the desktop panels' defaults; the config keys are exactly the
fimcore step-function kwargs (see fimcore docs/step-functions.md — these
dicts are the request schemas the desktop built from Qt widget state).
"""
import json
from datetime import datetime
from pathlib import Path

from tethysapp.fimsim_gui.job_types.registry import (
    StepJobType, UniformStepJobType, _check_choice, _check_number,
    _check_safe_name,
)


class DEMStepJobType(StepJobType):
    # wildcards also sweep up "dem (1).ascii"-style versioned leftovers
    clean_patterns = ("dem*.ascii", "dem*.prj", "DEM_*.tif")
    step_key = "dem"
    requires = ()

    def defaults(self) -> dict:
        return {"dem_res_m": 30, "dem_source": "3dep"}

    def check_values(self, config: dict) -> list:
        problems = []
        _check_choice(config, "dem_source", ("3dep", "hand"), problems)
        _check_choice(config, "dem_res_m", (1, 3, 10, 30, 90), problems)
        return problems

    # -- BE11: share full 3DEP tiles across users (fimcore's full-tile path
    #    already skips downloads for valid local tiles, so pre-staging them
    #    is a cache hit with zero engine changes; windowed *_aoi.tif reads
    #    are AOI-specific and not shared) --
    @staticmethod
    def _tiles_dir(ctx) -> Path:
        feat = ctx["aoi_features"][0]
        return Path(feat["folder_path"]).parent / f"DEM_raw_{feat['folder_name']}"

    @staticmethod
    def _needed_tiles(ctx) -> list:
        from fimcore.dem import DEM_RESOLUTION, _tile_names_for_bounds

        feat = ctx["aoi_features"][0]
        aoi_file = Path(feat["source_file"])
        data = json.loads(aoi_file.read_text())
        coords = [p for f in data["features"]
                  for ring in f["geometry"]["coordinates"] for p in ring]
        xs = [c[0] for c in coords]
        ys = [c[1] for c in coords]
        names = _tile_names_for_bounds(min(xs), min(ys), max(xs), max(ys))
        return [f"USGS_{DEM_RESOLUTION}_{t}.tif" for t in names]

    def prestage_shared_cache(self, storage, ctx, log_fn):
        from tethysapp.fimsim_gui.storage import shared_cache_key

        tiles_dir = self._tiles_dir(ctx)
        hits = 0
        for fname in self._needed_tiles(ctx):
            key = shared_cache_key("3dep", fname)
            if storage.exists(key):
                storage.download_to_path(key, tiles_dir / fname)
                hits += 1
        if hits:
            log_fn(f"cache: staged {hits} 3DEP tile(s) from the shared cache")

    def poststage_shared_cache(self, storage, ctx, log_fn):
        from tethysapp.fimsim_gui.storage import shared_cache_key

        tiles_dir = self._tiles_dir(ctx)
        if not tiles_dir.is_dir():
            return
        added = 0
        for p in sorted(tiles_dir.glob("USGS_*.tif")):
            if p.name.endswith("_aoi.tif"):
                continue  # windowed reads are AOI-specific
            key = shared_cache_key("3dep", p.name)
            if not storage.exists(key):
                with open(p, "rb") as fh:
                    storage.save(key, fh)
                added += 1
        if added:
            log_fn(f"cache: contributed {added} 3DEP tile(s) to the shared cache")

    def execute(self, ctx_path, ctx, config, log_fn):
        from fimcore.orchestrate import run_lisflood_dem_all

        cfg = self.merged(config)
        run_lisflood_dem_all(
            ctx_path, ctx,
            dem_res_m=float(cfg["dem_res_m"]),
            has_dem=bool(cfg.get("user_dem_path")),
            user_dem_path=cfg.get("user_dem_path"),
            log_fn=log_fn,
        )


class ManningStepJobType(UniformStepJobType):
    clean_patterns = ("lulc*.ascii", "lulc*.prj", "LULC_*.tif", "ManningN_*.tif")
    step_key = "manning"
    requires = ("dem",)
    orchestrator = "run_lisflood_manning_for_all_aois"

    extra_config_keys = ("fpfric_val", "manning_mapping")

    def defaults(self) -> dict:
        return {
            "fric_mode": "varying",            # "fixed" | "varying"
            "lulc_download_source": "esri",    # "esri" | "nlcd"
            "lulc_year": 2023,                 # Esri Sentinel-2 vintage
            "nlcd_year": "2021",
        }

    def check_values(self, config: dict) -> list:
        problems = []
        _check_choice(config, "fric_mode", ("fixed", "varying"), problems)
        _check_choice(config, "lulc_download_source", ("esri", "nlcd"), problems)
        # Chow (1959) tables top out well below 1; 0 would zero out friction
        _check_number(config, "fpfric_val", 0.001, 1.0, problems)
        _check_number(config, "lulc_year", 1985, 2035, problems)
        mapping = config.get("manning_mapping")
        if mapping is not None:
            if not isinstance(mapping, dict):
                problems.append("'manning_mapping' must be an object of "
                                "land-cover code → Manning's n")
            else:
                bad = [k for k, v in mapping.items()
                       if isinstance(v, bool) or not isinstance(v, (int, float))
                       or not (0.001 <= v <= 1.0)]
                if bad:
                    problems.append(
                        f"'manning_mapping' values must be numbers in "
                        f"[0.001, 1.0] — bad class(es): {', '.join(map(str, bad))}")
        return problems


class BCIStepJobType(UniformStepJobType):
    clean_patterns = ("*.bci", "NHD_flowlines_*.gpkg")
    step_key = "bci"
    requires = ("dem",)
    orchestrator = "run_lisflood_bci_for_all_aois"

    def defaults(self) -> dict:
        return {
            "upstream_mode": "varying_discharge",  # | "fixed_discharge"
            "downstream_type": "FREE",             # | "HFIX"
            # desktop default bed slope — without it the .bci says "FREE None"
            "downstream_slope": 0.0001,
            "use_nhd": True,
        }

    extra_config_keys = ("fixed_discharge_cms", "downstream_hfix",
                         "manual_upstream_x", "manual_upstream_y",
                         "manual_downstream_x", "manual_downstream_y")

    def check_values(self, config: dict) -> list:
        problems = []
        _check_choice(config, "upstream_mode",
                      ("varying_discharge", "fixed_discharge"), problems)
        _check_choice(config, "downstream_type", ("FREE", "HFIX"), problems)
        _check_number(config, "fixed_discharge_cms", 0.001, 1e9, problems, " m³/s")
        # desktop spinbox range for the FREE bed slope
        _check_number(config, "downstream_slope", 1e-7, 1.0, problems)
        _check_number(config, "downstream_hfix", -1000, 10000, problems, " m")
        if config.get("upstream_mode") == "fixed_discharge" \
                and config.get("fixed_discharge_cms") is None:
            problems.append("'fixed_discharge_cms' is required when the "
                            "upstream inflow is a fixed discharge")
        return problems


class BDYStepJobType(UniformStepJobType):
    clean_patterns = ("*.bdy", "*_discharge.csv")
    step_key = "bdy"
    requires = ("bci",)
    orchestrator = "run_lisflood_bdy_for_all_aois"

    def collect(self, ctx, workdir) -> str:
        # Also ship the raw discharge CSVs (true m³/s) — the .bdy holds
        # LISFLOOD's per-metre-width inflow (Q ÷ cell size), which scales
        # with DEM resolution and confuses charts/users.
        import shutil
        outputs = super().collect(ctx, workdir)
        feat_dir = Path(ctx["aoi_features"][0]["folder_path"])
        for p in feat_dir.glob("*.csv"):
            shutil.copy2(p, Path(outputs) / p.name)
        return outputs

    extra_config_keys = ("start_dt", "end_dt", "gage_id")

    #: NWM v3.0 retrospective coverage (fimcore.bdy constant)
    NWM_RETRO_START = datetime(1979, 2, 1)
    NWM_RETRO_END = datetime(2023, 1, 31)

    def defaults(self) -> dict:
        return {
            "bdy_source": "nwm_retro",
            "interval_hours": 1.0,
            "gap_handling": "interpolate",
        }

    def check_values(self, config: dict) -> list:
        problems = []
        _check_choice(config, "bdy_source",
                      ("nwm_retro", "nwm_forecast", "usgs"), problems)
        _check_choice(config, "interval_hours",
                      (0.5, 1, 1.0, 3, 3.0, 6, 6.0, 12, 12.0, 24, 24.0), problems)
        _check_choice(config, "gap_handling", ("interpolate", "zero", "hold"),
                      problems)

        window = {}
        for key in ("start_dt", "end_dt"):
            raw = config.get(key)
            if raw is None:
                problems.append(f"'{key}' is required — the event window "
                                f"(ISO datetime, e.g. 2016-10-05T00:00)")
                continue
            try:
                window[key] = datetime.fromisoformat(str(raw))
            except ValueError:
                problems.append(f"'{key}' is not a valid ISO datetime "
                                f"(got {raw!r})")
        if len(window) == 2:
            start, end = window["start_dt"], window["end_dt"]
            if start >= end:
                problems.append("the event window is empty — 'start_dt' must "
                                "be before 'end_dt'")
            elif (end - start).days > 366:
                problems.append("event windows are capped at 366 days — "
                                "narrow the window to the flood of interest")
            elif config.get("bdy_source", "nwm_retro") == "nwm_retro" and (
                    start < self.NWM_RETRO_START or end > self.NWM_RETRO_END):
                problems.append(
                    "the NWM retrospective covers 1979-02-01 to 2023-01-31 — "
                    "for dates outside that range use a USGS gage or the "
                    "NWM forecast")
        if config.get("bdy_source") == "usgs":
            gage = config.get("gage_id")
            if not (isinstance(gage, str) and gage.isdigit() and
                    8 <= len(gage) <= 15):
                problems.append("'gage_id' must be the USGS site number "
                                "(8–15 digits) when the source is a USGS gage")
        return problems

    def transform_config(self, cfg: dict, ctx) -> dict:
        for key in ("start_dt", "end_dt"):
            if isinstance(cfg.get(key), str):
                cfg[key] = datetime.fromisoformat(cfg[key])
            if cfg.get(key) is None:
                raise ValueError(
                    f"BDY needs '{key}' (ISO datetime) — the event window is required.")
        return cfg


class PARStepJobType(UniformStepJobType):
    clean_patterns = ("*.par",)
    step_key = "par"
    requires = ("bdy",)
    orchestrator = "run_lisflood_par_for_all_aois"

    def defaults(self) -> dict:
        return {
            "par_name": "model",
            "resroot": "res",
            "results_dir_name": "results",
            "initial_tstep": 10.0,
            "saveint": 3600.0,
            "massint": 600.0,
            "solver_mode": "acceleration",
            "drycheck_mode": "leave_default_off",
            "start_mode": "none",
        }

    extra_config_keys = ("sim_time",)

    def check_values(self, config: dict) -> list:
        problems = []
        _check_choice(config, "solver_mode",
                      ("acceleration", "adaptive_default",
                       "adaptive_fixed_timestep", "acceleration_with_routing",
                       "diffusion"), problems)
        # desktop spinbox ranges (gui/par_config_panel)
        _check_number(config, "sim_time", 1, 1e10, problems, " s")
        _check_number(config, "initial_tstep", 0.001, 3600, problems, " s")
        _check_number(config, "saveint", 1, 1e9, problems, " s")
        _check_number(config, "massint", 1, 1e9, problems, " s")
        for key in ("par_name", "resroot", "results_dir_name"):
            _check_safe_name(config, key, problems)
        return problems

    def transform_config(self, cfg: dict, ctx) -> dict:
        if cfg.get("sim_time") is None:
            # Desktop parity: sim_time (seconds) is the last time value in the
            # BDY step's .bdy file (gui/par_config_panel._read_bdy_sim_time).
            folder = Path(ctx["aoi_features"][0]["folder_path"])
            sim = None
            for bdy in sorted((folder / "lisflood-files").glob("*.bdy")):
                lines = [ln.strip() for ln in
                         bdy.read_text(errors="replace").splitlines() if ln.strip()]
                if len(lines) >= 4 and len(lines[-1].split()) >= 2:
                    try:
                        sim = float(lines[-1].split()[1])
                    except ValueError:
                        pass
            if sim is None:
                raise ValueError(
                    "PAR needs 'sim_time' — none given and no readable .bdy "
                    "from the BDY step to derive it from.")
            cfg["sim_time"] = float(sim)
        return cfg
