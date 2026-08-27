"""FIMSIM-BE5: job type registry (family pattern: FIMeval's job_types).

A StepJobType binds a wizard step key to the fimcore callable that does the
work. Registering a new step is data (a subclass with a run()), not plumbing —
BE7 adds manning/bci/bdy/par by cloning the DEM registration.
"""


class StepJobType:
    #: wizard step key (models.STEP_KEYS)
    step_key: str = ""

    def default_config(self) -> dict:
        """Defaults merged under the request config (BE7 formalizes schemas)."""
        return {}

    def run(self, workdir, aoi_geojson_path, config, log_fn) -> str:
        """Execute the step in *workdir* for the AOI materialized at
        *aoi_geojson_path*. Blocking; called on the Dask worker. Returns the
        directory whose files are this step's outputs (uploaded to storage
        by the wrapper)."""
        raise NotImplementedError

    # -- shared fimcore scaffolding (the proven smoke-test sequence) --
    def build_fimcore_project(self, workdir, aoi_geojson_path, log_fn):
        """create_project → inspect_features → subfolders → ctx, for ONE AOI.

        Each job owns one AOI (per-AOI fan-out), so the fimcore 'project' here
        is scratch scaffolding, not the user's Project row.
        """
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
