"""DEM step job type — the BE5 guinea pig; BE7's other steps clone this."""
import shutil
from pathlib import Path

from tethysapp.fimsim_gui.job_types.registry import StepJobType


class DEMStepJobType(StepJobType):
    step_key = "dem"

    def default_config(self) -> dict:
        return {"dem_res_m": 30, "dem_source": "3dep"}

    def run(self, workdir, aoi_geojson_path, config, log_fn) -> str:
        from fimcore.orchestrate import run_lisflood_dem_all

        cfg = {**self.default_config(), **(config or {})}
        ctx_path, ctx = self.build_fimcore_project(workdir, aoi_geojson_path, log_fn)

        run_lisflood_dem_all(
            ctx_path, ctx,
            dem_res_m=float(cfg["dem_res_m"]),
            has_dem=bool(cfg.get("user_dem_path")),
            user_dem_path=cfg.get("user_dem_path"),
            log_fn=log_fn,
        )

        # Collect this step's artifacts (skip the dem_tiles download cache).
        feat_dir = Path(ctx["aoi_features"][0]["folder_path"])
        outputs = Path(workdir) / "outputs"
        outputs.mkdir(exist_ok=True)
        for p in feat_dir.glob("*.tif"):
            shutil.copy2(p, outputs / p.name)
        lf = feat_dir / "lisflood-files"
        if lf.is_dir():
            for p in lf.iterdir():
                if p.is_file():
                    shutil.copy2(p, outputs / p.name)
        return str(outputs)
