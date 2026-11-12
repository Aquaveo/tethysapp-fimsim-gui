"""A2F (ARC-Curve2Flood) job types — the 'a*' wizard steps (FIMSIM A2F, design
docs/design-a2f.md).

Parity with the desktop's ARC tabs: DEM → Flowline → Streamflow → Run. The
engine is fimcore.arc_orchestrate (NenCarta under the hood); every
orchestrator keeps its state in the AOI's own workflow_context.json, which the
job wrapper persists with the workspace, so the steps chain across Dask jobs.
"""
import json
import os
import re
import shutil
from pathlib import Path

from fimcore.api_keys import NWM_KEY_ENV   # "FIMSIM_NWM_API_KEY"

from tethysapp.fimsim_gui.job_types.registry import (
    UniformStepJobType, _check_choice, _check_number,
)
from tethysapp.fimsim_gui.job_types.steps import DEMStepJobType, stage_one_pick

#: 3DEP 1/3 arc-second is ≈ 10 m; fimcore converts metres to degrees
#: (NenCarta needs a geographic DEM)
A2F_DEM_RES_M = (10, 30)
#: where the flowline comes from: an NHDPlus download, the GEOGLOWS v2
#: streams, or (A2F-2) the network picked from the Flowline tool
A2F_FLOWLINE_SOURCES = ("nhd", "geoglows", "prepared")


#: A2F-3: where the river flows come from. NWM uses the CIROH key (flows +
#: the return periods NenCarta sizes channels with); GEOGLOWS needs none.
A2F_STREAMFLOW_SOURCES = ("nwm", "geoglows")
#: which NWM record to read at that time; "auto" lets fimcore choose by date
#: (retrospective reanalysis ≤ 2023-02, analysis & assimilation, forecast)
A2F_NWM_RECORDS = ("auto", "retrospective", "analysis_assim", "forecast")
_ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _real_date(value) -> bool:
    """A real calendar day written YYYY-MM-DD (2019-02-30 is not)."""
    from datetime import date
    if not (isinstance(value, str) and _ISO_DATE.match(value)):
        return False
    try:
        date.fromisoformat(value)
    except ValueError:
        return False
    return True


def scrub_nwm_key(ctx, ctx_path=None) -> int:
    """Remove the NWM key fimcore saves into the context files — the AOI's
    workflow_context.json (nencarta_streamflow) and the project's
    (arc_flow_per_aoi) — before the workspace is persisted. The Run step reads
    it back from the worker environment instead. Returns copies removed."""
    removed = 0
    paths = [Path(f["folder_path"]) / "workflow_context.json"
             for f in ctx.get("aoi_features") or []]
    if ctx_path:
        paths.append(Path(ctx_path))
    for path in paths:
        if not path.exists():
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except ValueError:
            # unreadable (e.g. truncated by a failed write): the key can't be
            # cut out, so the file goes — and the step's own error survives
            path.unlink(missing_ok=True)
            continue
        removed += _drop_key(data)
        path.write_text(json.dumps(data, indent=2, default=str), encoding="utf-8")
    removed += _drop_key(ctx)
    return removed


def _drop_key(obj) -> int:
    """Delete every 'nwm_api_key' entry anywhere inside *obj* (dicts/lists)."""
    n = 0
    if isinstance(obj, dict):
        if obj.pop("nwm_api_key", None) is not None:
            n += 1
        for v in obj.values():
            n += _drop_key(v)
    elif isinstance(obj, list):
        for v in obj:
            n += _drop_key(v)
    return n


class A2FKeyMixin:
    """For A2F steps that call CIROH with the NWM key (needs_nwm_key): the
    key is masked in every log line and error message, and removed from the
    context files when the step ends — fimcore saves it there — so it never
    reaches the database or the persisted workspace."""

    needs_nwm_key = True

    @staticmethod
    def _mask(text) -> str:
        key = os.environ.get(NWM_KEY_ENV) or ""
        text = str(text)
        return text.replace(key, "***") if key else text

    def execute(self, ctx_path, ctx, config, log_fn):
        def masked_log(msg, *a, **kw):
            return log_fn(self._mask(msg), *a, **kw)
        from tethysapp.fimsim_gui.jobs import JobCancelled, JobTimeout
        try:
            self.run_engine(ctx_path, ctx, config, masked_log)
        except (JobCancelled, JobTimeout):
            raise   # the job wrapper's own control flow; fixed text, no key
        except Exception as exc:
            # StepRun.error stores the message + traceback: mask it, and drop
            # the original (from None) so its unmasked text isn't chained in
            raise RuntimeError(f"{type(exc).__name__}: {self._mask(exc)}") from None
        finally:
            self.clean_secrets(ctx, ctx_path)

    def run_engine(self, ctx_path, ctx, config, log_fn):
        super().execute(ctx_path, ctx, config, log_fn)

    def clean_secrets(self, ctx, ctx_path):
        scrub_nwm_key(ctx, ctx_path)


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


class A2FStreamflowJobType(A2FKeyMixin, UniformStepJobType):
    """Streamflow for A2F: the river flows to map, at one date + hour.
    fimcore checks the settings (and the NWM key) and, for NWM, fetches the
    flow at that time for every reach; NenCarta reads it in the Run step."""

    step_key = "astream"
    requires = ("aflow",)
    orchestrator = "run_arc_flowfile_for_all_aois"
    orchestrator_module = "fimcore.arc_orchestrate"
    clean_patterns = ("flow_series",)

    def defaults(self) -> dict:
        # Test Case 3 (Big Sioux): NWM, 2019-09-19 17:00 UTC
        return {"source": "nwm", "nwm_record": "auto",
                "date": None, "hour_utc": 12}

    def check_values(self, config: dict) -> list:
        problems = []
        _check_choice(config, "source", A2F_STREAMFLOW_SOURCES, problems)
        _check_choice(config, "nwm_record", A2F_NWM_RECORDS, problems)
        _check_number(config, "hour_utc", 0, 23, problems)
        if "hour_utc" in config and (config["hour_utc"] is None
                                     or isinstance(config["hour_utc"], float)):
            problems.append("'hour_utc' must be a whole hour (0–23)")
        if not _real_date(config.get("date")):
            problems.append("'date' must be the day to map, as YYYY-MM-DD")
        return problems

    def transform_config(self, cfg: dict, ctx) -> dict:
        """UI fields → fimcore's NenCarta streamflow settings (a snapshot)."""
        out = {
            "streamflow_source": "GEOGLOWS" if cfg["source"] == "geoglows"
            else "NWM_short_range",
            "forensic_forecast_date": cfg["date"].replace("-", ""),
            "forensic_forecast_hour": int(cfg["hour_utc"]),
            "period_mode": "snapshot",
        }
        if cfg["source"] == "nwm":
            out["record"] = cfg["nwm_record"]
        return out

    def collect(self, ctx, workdir) -> str:
        outputs = Path(workdir) / "outputs"
        outputs.mkdir(exist_ok=True)
        series = _arc_files(ctx) / "flow_series"
        if series.is_dir():
            for p in sorted(series.glob("*.csv")):
                shutil.copy2(p, outputs / p.name)
        return str(outputs)


#: A2F-4: run settings — Recommended (Joseph Gutenson's, with an automatic
#: rerun on the FIMsim classic settings when it fails) or Classic only
A2F_PRESETS = ("recommended", "classic")


class A2FRunJobType(A2FKeyMixin, UniformStepJobType):
    """Run for A2F: NenCarta (ARC + Curve2Flood) maps the flood for the
    Streamflow step's flows; fimcore reprojects the maps to the AOI's UTM grid
    (<AOI>/FloodMaps/depth_*.tif + FIM_*.tif). Results get the same depth
    overlay as LISFLOOD-FP, plus which settings actually ran."""

    step_key = "arun"
    requires = ("astream",)
    orchestrator = "run_arc_curve2flood_for_all_aois"
    orchestrator_module = "fimcore.arc_orchestrate"
    clean_patterns = ("nencarta-output", "FloodMaps", "nencarta*.json")

    def defaults(self) -> dict:
        return {"preset": "recommended"}

    def check_values(self, config: dict) -> list:
        problems = []
        _check_choice(config, "preset", A2F_PRESETS, problems)
        return problems

    def transform_config(self, cfg: dict, ctx) -> dict:
        from fimcore.arc_presets import preset
        out = preset(cfg["preset"])
        # maps on the DEM's own grid (fimcore defaults to 10 m whatever the DEM)
        out["output_res_m"] = _dem_res_m(ctx)
        return out

    def run_engine(self, ctx_path, ctx, config, log_fn):
        from fimcore.deps import FIX_HINT
        from fimcore.nencarta_run import flood_mapping_cli

        if flood_mapping_cli() is None:
            raise RuntimeError("NenCarta's flood-mapping command is not installed "
                               "on this worker.\n" + FIX_HINT)
        os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")  # NenCarta imports PyQt5
        super().run_engine(ctx_path, ctx, config, log_fn)
        if not _floodmaps(ctx, "depth_*.tif"):
            raise RuntimeError("NenCarta finished but produced no flood depth map — "
                               "the log above says why")

    def clean_secrets(self, ctx, ctx_path):
        super().clean_secrets(ctx, ctx_path)
        # the NenCarta JSON files carry the key in plain text
        places = [Path(f["folder_path"]) for f in ctx.get("aoi_features") or []]
        if ctx_path:
            places.append(Path(ctx_path).parent)
        for place in places:
            for p in place.glob("nencarta*.json"):
                p.unlink(missing_ok=True)
        # NenCarta's own working folder: ARC's intermediates, which nothing
        # reads afterwards (Results use FloodMaps/), and which we can't vouch
        # are key-free — never persist it
        for feat in ctx.get("aoi_features") or []:
            shutil.rmtree(Path(feat["folder_path"]) / "nencarta-output", ignore_errors=True)

    def collect(self, ctx, workdir) -> str:
        import rasterio

        from tethysapp.fimsim_gui.job_types.previews import write_depth_overlay

        outputs = Path(workdir) / "outputs"
        outputs.mkdir(exist_ok=True)
        for p in _floodmaps(ctx, "*.tif"):
            shutil.copy2(p, outputs / p.name)
        # v1 maps one moment, so one depth map; a duration run (later) would
        # want the cell-wise maximum here rather than the first timestep
        depth_tif = _floodmaps(ctx, "depth_*.tif")[0]
        with rasterio.open(depth_tif) as src:
            depth = src.read(1, masked=True).filled(0).astype("float32")
            depth[depth < 0] = 0.0
            write_depth_overlay(depth, src.transform, src.crs, src.bounds, outputs,
                                extra={"settings_used": _settings_used(ctx)})
        return str(outputs)


def _floodmaps(ctx, pattern) -> list:
    folder = Path(ctx["aoi_features"][0]["folder_path"]) / "FloodMaps"
    return sorted(folder.glob(pattern)) if folder.is_dir() else []


def _dem_res_m(ctx) -> float:
    """The A2F DEM's cell size in metres (fimcore stores it in degrees in the
    AOI context); 10 m when it can't be read."""
    path = Path(ctx["aoi_features"][0]["folder_path"]) / "workflow_context.json"
    try:
        deg = float(json.loads(path.read_text(encoding="utf-8"))["dem_res_m"])
    except (OSError, ValueError, KeyError, TypeError):
        return 10.0
    return float(round(deg * 111320.0)) if deg < 1 else deg


def _settings_used(ctx):
    """Which settings mapped the flood ("the FIMsim classic settings" after a
    fallback) — fimcore records it in the AOI's workflow_context.json."""
    path = Path(ctx["aoi_features"][0]["folder_path"]) / "workflow_context.json"
    try:
        return json.loads(path.read_text(encoding="utf-8")).get("arc_settings_used")
    except (OSError, ValueError):
        return None
