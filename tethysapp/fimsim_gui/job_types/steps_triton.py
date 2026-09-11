"""TRITON deck-generation job types (the 't*' wizard steps).

Parity with the desktop's TRITON tabs: Terrain → Friction → BC → Hydrograph →
Config, writing each AOI's ``triton-files/`` deck (dem.asc, friction.asc,
.src + .extbc, .hyg, .cfg). There is NO server-side TRITON run step — the
desktop hands the package to the user to execute on their own GPU/HPC, and
the web app does the same (Results = download the deck).

All orchestrators live in fimcore.triton_orchestrate and follow the same
uniform (ctx_path, ctx, per_aoi_configs, log_fn) contract as the LISFLOOD
ones, so most of this file is defaults + validation.
"""
import shutil
from pathlib import Path

from tethysapp.fimsim_gui.job_types.registry import (
    UniformStepJobType, _check_choice, _check_number,
)
from tethysapp.fimsim_gui.job_types.steps import BDYStepJobType, DEMStepJobType


class TritonDeckMixin:
    """Shared TRITON behavior: mark the scratch project as a TRITON one, and
    collect from each AOI's ``triton-files/`` folder (the LISFLOOD default
    collect only ships ``lisflood-files/``)."""

    def prepare(self, workdir, aoi_geojson_path, log_fn):
        ctx_path, ctx = super().prepare(workdir, aoi_geojson_path, log_fn)
        # fimcore's shared steps key TRITON mode off ctx["triton_dir"] (the
        # desktop stamps it at project setup); without it the DEM lands in
        # lisflood-files/dem.ascii and the .cfg step can't find dem.asc
        ctx["triton_dir"] = str(Path(ctx["project_dir"]) / "triton_files")
        ctx.pop("lisflood_dir", None)
        from fimcore.context import save_context
        save_context(ctx_path, ctx)
        return ctx_path, ctx

    def collect(self, ctx, workdir) -> str:
        feat_dir = Path(ctx["aoi_features"][0]["folder_path"])
        outputs = Path(workdir) / "outputs"
        outputs.mkdir(exist_ok=True)
        for p in feat_dir.glob("*.tif"):
            shutil.copy2(p, outputs / p.name)
        tf = feat_dir / "triton-files"
        if tf.is_dir():
            for p in tf.iterdir():
                if p.is_file():
                    shutil.copy2(p, outputs / p.name)
        return str(outputs)


class TritonDEMJobType(TritonDeckMixin, DEMStepJobType):
    """Terrain for TRITON: same 3DEP download/shared-tile cache as the
    LISFLOOD DEM step, but grids to TRITON's dem.asc via the TRITON
    orchestrator."""

    step_key = "tdem"
    requires = ()
    clean_patterns = ("dem*.asc", "dem*.ascii", "dem*.prj", "DEM_*.tif")

    def defaults(self) -> dict:
        return {"dem_res_m": 30}

    def check_values(self, config: dict) -> list:
        problems = []
        _check_choice(config, "dem_res_m", (1, 3, 10, 30, 90), problems)
        return problems

    def execute(self, ctx_path, ctx, config, log_fn):
        from fimcore.triton_orchestrate import run_triton_dem_all

        cfg = self.merged(config)
        run_triton_dem_all(
            ctx_path, ctx,
            dem_res_m=float(cfg["dem_res_m"]),
            has_dem=False,
            log_fn=log_fn,
        )


class TritonFrictionJobType(TritonDeckMixin, UniformStepJobType):
    step_key = "tfric"
    requires = ("tdem",)
    orchestrator = "run_triton_manning_for_all_aois"
    orchestrator_module = "fimcore.triton_orchestrate"
    clean_patterns = ("friction*.asc", "lulc*.asc", "LULC_*.tif", "ManningN_*.tif")
    extra_config_keys = ("fpfric_val", "manning_mapping", "lulc_class_to_n")

    def defaults(self) -> dict:
        return {
            "fric_mode": "varying",
            "lulc_source": "download",   # esri | "download_nlcd" for NLCD
            "lulc_year": 2023,
            "nlcd_year": "2021",
            "dem_res_m": 30,             # must match tdem for grid alignment
        }

    def check_values(self, config: dict) -> list:
        problems = []
        _check_choice(config, "fric_mode", ("fixed", "varying"), problems)
        _check_choice(config, "lulc_source", ("download", "download_nlcd"), problems)
        _check_number(config, "fpfric_val", 0.001, 1.0, problems)
        _check_number(config, "lulc_year", 1985, 2035, problems)
        _check_choice(config, "dem_res_m", (1, 3, 10, 30, 90), problems)
        return problems


class TritonBCJobType(TritonDeckMixin, UniformStepJobType):
    step_key = "tbc"
    requires = ("tdem",)
    orchestrator = "run_triton_bc_for_all_aois"
    orchestrator_module = "fimcore.triton_orchestrate"
    clean_patterns = ("*.src", "*.extbc", "*_inflow_loc.txt", "NHD_flowlines_*.gpkg")
    extra_config_keys = ("value",)

    def defaults(self) -> dict:
        # desktop BC panel defaults: normal slope 0.001
        return {"bc_type": 2}

    def check_values(self, config: dict) -> list:
        problems = []
        # 1 (level vs time) needs a stage-file upload — not in the web alpha
        _check_choice(config, "bc_type", (0, 2, 3), problems)
        _check_number(config, "value", 1e-7, 10.0, problems)
        return problems

    def transform_config(self, cfg: dict, ctx) -> dict:
        if cfg.get("value") is None:
            cfg["value"] = 0.001 if cfg.get("bc_type") == 2 else 0.5
        return cfg


class TritonHydroJobType(TritonDeckMixin, BDYStepJobType):
    """Hydrograph: same sources/window/validation as the LISFLOOD Flow Data
    step (inherited), but writes TRITON's .hyg via the TRITON orchestrator."""

    step_key = "thyg"
    requires = ("tbc",)
    orchestrator = "run_triton_hydro_for_all_aois"
    orchestrator_module = "fimcore.triton_orchestrate"
    clean_patterns = ("*.hyg", "*_strmflow_timeseries.csv", "*_discharge.csv")


class TritonCfgJobType(TritonDeckMixin, UniformStepJobType):
    step_key = "tcfg"
    requires = ("thyg",)
    orchestrator = "run_triton_cfg_for_all_aois"
    orchestrator_module = "fimcore.triton_orchestrate"
    clean_patterns = ("*.cfg",)

    def defaults(self) -> dict:
        # desktop Config panel defaults (ASC/SEQ/huv; Δt 10 s; hourly output)
        return {
            "output_format": "ASC",
            "print_option": "huv",
            "time_step": 10.0,
            "print_interval": 3600.0,
            "courant": 0.5,
        }

    def check_values(self, config: dict) -> list:
        problems = []
        _check_choice(config, "output_format", ("ASC", "GTIFF", "BIN"), problems)
        _check_choice(config, "print_option", ("h", "huv"), problems)
        _check_number(config, "time_step", 0.001, 3600, problems, " s")
        _check_number(config, "print_interval", 1, 1e7, problems, " s")
        _check_number(config, "courant", 0.05, 1.0, problems)
        return problems
