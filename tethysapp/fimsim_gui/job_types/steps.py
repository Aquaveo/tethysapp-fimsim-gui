"""FIMSIM-BE7: the five LISFLOOD-FP step job types.

Defaults mirror the desktop panels' defaults; the config keys are exactly the
fimcore step-function kwargs (see fimcore docs/step-functions.md — these
dicts are the request schemas the desktop built from Qt widget state).
"""
import json
from datetime import datetime
from pathlib import Path

from tethysapp.fimsim_gui.job_types.registry import StepJobType, UniformStepJobType


class DEMStepJobType(StepJobType):
    step_key = "dem"
    requires = ()

    def defaults(self) -> dict:
        return {"dem_res_m": 30, "dem_source": "3dep"}

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
        xs = [c[0] for c in coords]; ys = [c[1] for c in coords]
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
    step_key = "manning"
    requires = ("dem",)
    orchestrator = "run_lisflood_manning_for_all_aois"

    def defaults(self) -> dict:
        return {
            "fric_mode": "varying",            # "fixed" | "varying"
            "lulc_download_source": "esri",    # "esri" | "nlcd"
            "lulc_year": 2023,                 # Esri Sentinel-2 vintage
            "nlcd_year": "2021",
        }


class BCIStepJobType(UniformStepJobType):
    step_key = "bci"
    requires = ("dem",)
    orchestrator = "run_lisflood_bci_for_all_aois"

    def defaults(self) -> dict:
        return {
            "upstream_mode": "varying_discharge",  # | "fixed_discharge"
            "downstream_type": "FREE",             # | "HFIX"
            "use_nhd": True,
        }


class BDYStepJobType(UniformStepJobType):
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

    def defaults(self) -> dict:
        return {
            "bdy_source": "nwm_retro",
            "interval_hours": 1.0,
            "gap_handling": "interpolate",
        }

    def transform_config(self, cfg: dict, ctx) -> dict:
        for key in ("start_dt", "end_dt"):
            if isinstance(cfg.get(key), str):
                cfg[key] = datetime.fromisoformat(cfg[key])
            if cfg.get(key) is None:
                raise ValueError(
                    f"BDY needs '{key}' (ISO datetime) — the event window is required.")
        return cfg


class PARStepJobType(UniformStepJobType):
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

    def transform_config(self, cfg: dict, ctx) -> dict:
        if cfg.get("sim_time") is None:
            # Desktop parity: sim_time (seconds) is the last time value in the
            # BDY step's .bdy file (gui/par_config_panel._read_bdy_sim_time).
            folder = Path(ctx["aoi_features"][0]["folder_path"])
            sim = None
            for bdy in sorted((folder / "lisflood-files").glob("*.bdy")):
                lines = [l.strip() for l in
                         bdy.read_text(errors="replace").splitlines() if l.strip()]
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
