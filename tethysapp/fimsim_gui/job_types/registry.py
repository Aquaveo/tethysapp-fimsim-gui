"""FIMSIM-BE7: job type registry — one class per wizard step.

Every step follows the same lifecycle on the worker:
  prepare()  — scratch fimcore project for the job's single AOI
  (wrapper restores the AOI's persisted workspace + remaps ctx paths)
  execute()  — the fimcore orchestrator call, per_aoi_configs=[config]
  collect()  — which files are this step's user-facing outputs
  (wrapper persists the workspace back + uploads outputs)

`requires` drives the BE7 dependency guard: a step submits only when the
latest run of each prerequisite step succeeded.
"""
import shutil
from pathlib import Path


class StepJobType:
    #: wizard step key (models.STEP_KEYS)
    step_key: str = ""
    #: step keys whose latest run must be 'succeeded' before this submits
    requires: tuple = ()

    def defaults(self) -> dict:
        return {}

    def merged(self, config: dict) -> dict:
        return {**self.defaults(), **(config or {})}

    # -- worker lifecycle --
    def prepare(self, workdir, aoi_geojson_path, log_fn):
        """create_project → inspect_features → subfolders → ctx, for ONE AOI."""
        from dataclasses import asdict

        from fimcore.context import save_context
        from fimcore.multi_aoi import create_aoi_subfolders, inspect_features
        from fimcore.project import create_project

        ctx_path, ctx = create_project(str(workdir), "job", log_fn=log_fn)
        feats = inspect_features(str(aoi_geojson_path), log_fn=log_fn)
        if not feats:
            raise RuntimeError("AOI file contains no polygon features")
        feats = create_aoi_subfolders(ctx["project_dir"], feats[:1], log_fn=log_fn)
        ctx["aoi_features"] = [asdict(f) for f in feats]
        save_context(ctx_path, ctx)
        return ctx_path, ctx

    def execute(self, ctx_path, ctx, config, log_fn):
        raise NotImplementedError

    # -- shared-cache hooks (BE11): no-ops unless a step caches something --
    def prestage_shared_cache(self, storage, ctx, log_fn):
        pass

    def poststage_shared_cache(self, storage, ctx, log_fn):
        pass

    def collect(self, ctx, workdir) -> str:
        """Default outputs: the AOI folder's rasters + the LISFLOOD deck."""
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


class UniformStepJobType(StepJobType):
    """Steps whose orchestrator takes (ctx_path, ctx, per_aoi_configs, log_fn)."""

    #: attribute name on fimcore.orchestrate
    orchestrator: str = ""

    def transform_config(self, cfg: dict, ctx) -> dict:
        """Hook: JSON config → fimcore kwargs (e.g. ISO strings → datetime)."""
        return cfg

    def execute(self, ctx_path, ctx, config, log_fn):
        import fimcore.orchestrate as orch

        fn = getattr(orch, self.orchestrator)
        cfg = self.transform_config(self.merged(config), ctx)
        fn(ctx_path, ctx, per_aoi_configs=[cfg], log_fn=log_fn)
