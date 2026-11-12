"""A2F (ARC-Curve2Flood) job types — the 'a*' wizard steps (FIMSIM A2F, design
docs/design-a2f.md).

Parity with the desktop's ARC tabs: DEM → Flowline → Streamflow → Run. The
engine is fimcore.arc_orchestrate (NenCarta under the hood); every
orchestrator keeps its state in the AOI's own workflow_context.json, which the
job wrapper persists with the workspace, so the steps chain across Dask jobs.
"""
import shutil
from pathlib import Path

from tethysapp.fimsim_gui.job_types.registry import (
    UniformStepJobType, _check_choice,
)
from tethysapp.fimsim_gui.job_types.steps import DEMStepJobType, stage_one_pick

#: 3DEP 1/3 arc-second is ≈ 10 m; fimcore converts metres to degrees
#: (NenCarta needs a geographic DEM)
A2F_DEM_RES_M = (10, 30)
#: where the flowline comes from: an NHDPlus download, the GEOGLOWS v2
#: streams, or (A2F-2) the network picked from the Flowline tool
A2F_FLOWLINE_SOURCES = ("nhd", "geoglows", "prepared")


def _arc_files(ctx) -> Path:
    return Path(ctx["aoi_features"][0]["folder_path"]) / "arc-files"


class A2FDEMJobType(DEMStepJobType):
    """DEM for A2F: same inputs as the LISFLOOD DEM step (3DEP download with
    the shared tile cache, an uploaded GeoTIFF, or a picked DEM-tool output —
    all staged by DEMStepJobType.prestage_inputs), gridded by fimcore to the
    EPSG:4326 GeoTIFF NenCarta reads."""

    step_key = "adem"
    requires = ()
    # dem_clip_to_* is fimcore's clip of an uploaded / picked DEM
    clean_patterns = ("DEM_*.tif", "dem*.ascii", "dem*.prj", "dem_clip_to_*.tif")

    @staticmethod
    def _tiles_dir(ctx) -> Path:
        # run_arc_dem_all sets project_dir = the AOI folder and aoi_name =
        # its folder name, so fimcore.dem keeps the full 3DEP tiles INSIDE the
        # AOI folder (the shared-cache hooks must stage them right there)
        feat = ctx["aoi_features"][0]
        return Path(feat["folder_path"]) / f"DEM_raw_{feat['folder_name']}"

    def defaults(self) -> dict:
        return {"dem_res_m": 10, "dem_input": "download"}

    def check_values(self, config: dict) -> list:
        problems = []
        _check_choice(config, "dem_res_m", A2F_DEM_RES_M, problems)
        return problems

    def execute(self, ctx_path, ctx, config, log_fn):
        from fimcore.arc_orchestrate import run_arc_dem_all

        cfg = self.merged(config)
        user_paths = cfg.get("user_dem_path") or None   # staged by prestage_inputs
        run_arc_dem_all(
            ctx_path, ctx,
            per_aoi_configs=[{
                "dem_res_m": float(cfg["dem_res_m"]),
                "has_dem": bool(user_paths),
                "user_dem_path": user_paths,
                "dem_source": "3dep",
            }],
            log_fn=log_fn,
        )


class A2FFlowlineJobType(UniformStepJobType):
    """Flowline for A2F: the stream network NenCarta maps along, saved as
    ``<AOI>/arc-files/flowline.shp`` with the reach IDs the streamflow source
    needs (COMID for NWM, LINKNO for GEOGLOWS)."""

    step_key = "aflow"
    requires = ("adem",)
    orchestrator = "run_arc_flowline_for_all_aois"
    orchestrator_module = "fimcore.arc_orchestrate"
    clean_patterns = ("flowline.*", "preview_features.geojson")
    # A2F-2: a picked Flowline-tool network arrives as user_flowline_keys (its
    # .shp or .gpkg key; a shapefile's side files sit next to it); the local
    # path is SERVER-ONLY, set by prestage_inputs
    extra_config_keys = ("user_flowline_keys",)
    server_only_keys = ("user_path",)

    def defaults(self) -> dict:
        return {"source": "nhd"}

    def check_values(self, config: dict) -> list:
        problems = []
        _check_choice(config, "source", A2F_FLOWLINE_SOURCES, problems)
        return problems

    def prestage_inputs(self, storage, ctx, config, log_fn):
        if self.merged(config)["source"] != "prepared":
            return
        from tethysapp.fimsim_gui.job_types.steps import stage_supplied
        from tethysapp.fimsim_gui.prepared import shapefile_part_keys

        path = stage_one_pick(storage, ctx, config, "flowline", "flowline", log_fn)
        if path.endswith(".shp"):
            [key] = config["user_flowline_keys"]
            parts = [k for k in shapefile_part_keys(key) if storage.exists(k)]
            stage_supplied(storage, ctx, parts, "flowline")
        config["user_path"] = path

    def transform_config(self, cfg: dict, ctx) -> dict:
        # fimcore calls a supplied network source="user"
        cfg = {k: v for k, v in cfg.items() if k != "user_flowline_keys"}
        if cfg["source"] == "prepared":
            cfg["source"] = "user"
        return cfg

    def collect(self, ctx, workdir) -> str:
        outputs = Path(workdir) / "outputs"
        outputs.mkdir(exist_ok=True)
        for p in sorted(_arc_files(ctx).glob("flowline.*")):
            if p.is_file():
                shutil.copy2(p, outputs / p.name)
        try:
            self._write_preview(ctx, outputs)
        except Exception:  # a preview must never fail the step
            pass
        return str(outputs)

    @staticmethod
    def _write_preview(ctx, outputs):
        import geopandas as gpd

        from tethysapp.fimsim_gui.job_types.previews import write_flowline_preview

        shp = _arc_files(ctx) / "flowline.shp"
        if not shp.exists():
            return
        write_flowline_preview(None, gpd.read_file(shp), [],
                               Path(outputs) / "preview_features.geojson")
