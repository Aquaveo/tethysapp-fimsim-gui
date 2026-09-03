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
import re
import shutil
from pathlib import Path

#: filenames that end up inside the LISFLOOD deck must stay shell- and
#: parser-safe (whitespace breaks the .par format; separators break paths)
SAFE_NAME_RE = re.compile(r"^[A-Za-z0-9._-]{1,64}$")


def _check_choice(cfg, key, options, problems):
    """Reject cfg[key] unless it is one of `options` (missing key is fine)."""
    if key in cfg and cfg[key] not in options:
        problems.append(
            f"'{key}' must be one of {sorted(str(o) for o in options)} "
            f"(got {cfg[key]!r})")


def _check_number(cfg, key, lo, hi, problems, unit=""):
    """Reject cfg[key] unless it is a number within [lo, hi] (missing is fine)."""
    if key not in cfg or cfg[key] is None:
        return
    val = cfg[key]
    if isinstance(val, bool) or not isinstance(val, (int, float)):
        problems.append(f"'{key}' must be a number (got {val!r})")
    elif not (lo <= val <= hi):
        problems.append(f"'{key}' must be between {lo} and {hi}{unit} (got {val})")


def _check_safe_name(cfg, key, problems):
    """Reject cfg[key] unless it is a deck-safe filename fragment."""
    if key in cfg and not (isinstance(cfg[key], str) and SAFE_NAME_RE.match(cfg[key])):
        problems.append(
            f"'{key}' must be letters/digits/._- only, max 64 chars "
            f"(got {cfg[key]!r}) — spaces break the LISFLOOD-FP deck")


class StepJobType:
    #: wizard step key (models.STEP_KEYS)
    step_key: str = ""
    #: step keys whose latest run must be 'succeeded' before this submits
    requires: tuple = ()
    #: workspace globs this step regenerates. Deleted right after the
    #: workspace restore: otherwise fimcore's next_free_path sees the stale
    #: copy and writes "<name> (1).<ext>", which the old file then shadows
    #: (the .par kept pointing at a superseded .bci → bone-dry reruns).
    clean_patterns: tuple = ()

    def clean_workspace(self, ctx, log_fn):
        folder = Path(ctx["aoi_features"][0]["folder_path"])
        removed = 0
        for pat in self.clean_patterns:
            for p in list(folder.rglob(pat)):
                if p.is_dir():
                    shutil.rmtree(p, ignore_errors=True)
                    removed += 1
                elif p.is_file():
                    p.unlink(missing_ok=True)
                    removed += 1
        if removed:
            log_fn(f"workspace: removed {removed} superseded item(s) this "
                   f"step regenerates")

    #: config keys accepted beyond defaults() (per-step extras such as
    #: manning_mapping or the BDY event window)
    extra_config_keys: tuple = ()
    #: keys only the SERVER may set — stripped from client configs before
    #: validation (e.g. run's solver_path: client-supplied would execute an
    #: arbitrary binary on the worker)
    server_only_keys: tuple = ()

    def defaults(self) -> dict:
        return {}

    def merged(self, config: dict) -> dict:
        return {**self.defaults(), **(config or {})}

    # -- input validation (BE: submit endpoint) --
    def validate_config(self, config: dict) -> list:
        """Return human-readable reasons this config must be rejected.

        Empty list = acceptable. The base check rejects unknown keys —
        fimcore's step functions are keyword-only, so a stray key from a
        stale client crashes the worker mid-job; better to bounce it at the
        API with a reason. Subclasses layer value checks via check_values().
        """
        if not isinstance(config, dict):
            return ["config must be a JSON object"]
        allowed = set(self.defaults()) | set(self.extra_config_keys)
        problems = [
            f"unknown option '{k}' — this step accepts: "
            f"{', '.join(sorted(allowed))}"
            for k in sorted(set(config) - allowed)
        ]
        problems.extend(self.check_values(config))
        return problems

    def check_values(self, config: dict) -> list:
        """Hook: per-step value/range checks. Missing keys are never errors
        (defaults fill them); only reject values that are present and bad."""
        return []

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
