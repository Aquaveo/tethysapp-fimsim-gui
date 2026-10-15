"""FIMSIM-BE25: the Preparing Input Data tools as job types.

Desktop Track A (gui/mode_dem.py, mode_lulc_manning.py, mode_flowline.py,
mode_streamflow.py): four standalone products for a study area, no model.
Each tool is ONE job step on the generic step form; its orchestrator is the
fimcore entry point the desktop calls (run_dem_mode, run_lulc_mode,
run_flowline_mode, run_streamflow_mode), which builds its own neutral
per-feature ctx (orchestrate._make_feature_ctx) — so the scratch project's
lisflood_dir marker never routes a tool into the LISFLOOD layout.

Config keys are exactly the desktop's per-AOI dict keys (fimcore's names);
see docs/design-input-prep.md for the table.
"""
import shutil
from datetime import datetime, timedelta, timezone
from pathlib import Path

from tethysapp.fimsim_gui.job_types.registry import (
    StepJobType, _check_bool, _check_choice, _check_number,
)
from tethysapp.fimsim_gui.job_types.steps import (
    DEMStepJobType, _check_lulc_years, _check_manning_mapping, _check_window,
)

#: raster export formats fimcore.export.export_raster writes
RASTER_FORMATS = ("tif", "gpkg", "asc")
#: flowline_mode's per-output formats (vector, raster burn, or WKT CSV)
FLOWLINE_FORMATS = ("shp", "gpkg", "tif", "csv")
#: the web Terrain step's floor (FE51): finer cells are interpolated, not measured
MIN_CELL_M = 10


class ToolMixin:
    """Shared by the four tools: no prerequisites, the AOI as the fimcore
    dataclass the standalone entry points take, and collect() = every file
    the tool left at the top of the AOI folder (shapefile sidecars included;
    the DEM_raw_* tile cache and fimcore's scratch stay behind)."""

    requires = ()
    extra_config_keys = ()
    server_only_keys = ()
    #: engine scratch that is never an output
    skip_names = ("workflow_context.json", "_snap.tif")

    @staticmethod
    def feature(ctx):
        """ctx["aoi_features"][0] (asdict'd by prepare()) → AOIFeatureInfo."""
        from fimcore.multi_aoi import AOIFeatureInfo
        return AOIFeatureInfo(**ctx["aoi_features"][0])

    def collect(self, ctx, workdir) -> str:
        feat_dir = Path(ctx["aoi_features"][0]["folder_path"])
        outputs = Path(workdir) / "outputs"
        outputs.mkdir(exist_ok=True)
        for p in sorted(feat_dir.iterdir()):
            if (p.is_file() and p.name not in self.skip_names
                    and not p.name.endswith(".aux.xml")):
                shutil.copy2(p, outputs / p.name)
        return str(outputs)


class DemToolJobType(ToolMixin, DEMStepJobType):
    """DEM tool: 3DEP or HAND, any cell size ≥ 10 m, TIF / GPKG / ASC.
    Inherits the LISFLOOD Terrain step's shared 3DEP tile cache (BE11);
    no user-DEM upload path here (that is the Terrain step's BE17)."""

    step_key = "dem_tool"
    clean_patterns = ("DEM_*.tif", "DEM_*.gpkg", "DEM_*.asc", "DEM_*.prj")

    def defaults(self) -> dict:
        return {"dem_source": "3dep", "dem_res_m": 10, "out_format": "tif"}

    def check_values(self, config: dict) -> list:
        problems = []
        _check_choice(config, "dem_source", ("3dep", "hand"), problems)
        _check_number(config, "dem_res_m", MIN_CELL_M, 1000, problems, " m")
        _check_choice(config, "out_format", RASTER_FORMATS, problems)
        return problems

    @staticmethod
    def _tiles_dir(ctx) -> Path:
        # fimcore.dem puts the full tiles at ctx["project_dir"]/DEM_raw_<aoi_name>;
        # run_dem_mode's per-feature ctx (orchestrate._make_feature_ctx) sets
        # project_dir = the AOI folder and aoi_name = "<aoi stem>_f<index>".
        # (The LISFLOOD step's tiles sit one level up — DEMStepJobType.)
        feat = ctx["aoi_features"][0]
        aoi_name = f"{Path(feat['source_file']).stem}_f{feat['feature_index']}"
        return Path(feat["folder_path"]) / f"DEM_raw_{aoi_name}"

    def execute(self, ctx_path, ctx, config, log_fn):
        from fimcore.orchestrate import run_dem_mode

        cfg = self.merged(config)
        run_dem_mode(
            ctx["project_dir"], [self.feature(ctx)],
            dem_cell_size_m=float(cfg["dem_res_m"]),
            out_format=cfg["out_format"],
            dem_source=cfg["dem_source"],
            log_fn=log_fn,
        )

    def collect(self, ctx, workdir) -> str:
        from tethysapp.fimsim_gui.job_types.previews import write_dem_preview
        outputs = super().collect(ctx, workdir)
        try:
            write_dem_preview(ctx, outputs)
        except Exception:  # a preview must never fail the step
            pass
        return outputs


#: create_manning_from_lulc's fill for pixels no class covers
MANNING_FALLBACK_N = 0.045


def full_manning_mapping(lulc_source, submitted=None) -> dict:
    """Every class default of the source's Manning table plus the fallback,
    with the user's (possibly partial) edits overlaid — the ManningTable
    only submits a mapping after an edit, and only what was edited."""
    from fimcore.nlcd import NLCD_MANNING, SENTINEL2_MANNING
    table = NLCD_MANNING if lulc_source == "nlcd" else SENTINEL2_MANNING
    mapping = {str(code): dflt for code, (_name, _lo, _hi, dflt) in table.items()
               if dflt is not None}
    mapping["default"] = MANNING_FALLBACK_N
    mapping.update({str(k): v for k, v in (submitted or {}).items()})
    return mapping


class LulcToolJobType(ToolMixin, StepJobType):
    """LULC & Manning's n tool: NLCD or Esri Sentinel-2 land cover in the
    chosen format, optionally the Manning's n grid from the editable table
    (FE52 rules: hard band enforced, per-class ranges warn)."""

    step_key = "lulc_tool"
    clean_patterns = ("LULC_*.*", "ManningN_*.*", "_snap.tif")
    extra_config_keys = ("manning_mapping",)

    def defaults(self) -> dict:
        # desktop aoi_lulc_card defaults (NLCD at its native 30 m)
        return {
            "lulc_source": "nlcd",       # "nlcd" | "sentinel2"
            "nlcd_year": "2021",
            "sentinel2_year": 2023,
            "cell_size_m": 30,
            "lulc_format": "tif",
            "do_manning": True,
            "manning_format": "tif",
        }

    def check_values(self, config: dict) -> list:
        problems = []
        _check_choice(config, "lulc_source", ("nlcd", "sentinel2"), problems)
        _check_lulc_years(config, problems, s2_key="sentinel2_year")
        _check_number(config, "cell_size_m", MIN_CELL_M, 1000, problems, " m")
        _check_choice(config, "lulc_format", RASTER_FORMATS, problems)
        _check_bool(config, "do_manning", problems)
        _check_choice(config, "manning_format", RASTER_FORMATS + ("shp",), problems)
        _check_manning_mapping(config, problems)
        return problems

    def transform_config(self, cfg: dict, ctx) -> dict:
        """The desktop card's per-AOI dict (run_lulc_mode keys) as a copy,
        with the FULL Manning mapping (fimcore stamps only the listed
        classes over a flat 0.045); stash what the preview needs
        (collect() doesn't see the config)."""
        out = dict(cfg)
        out["manning_mapping"] = full_manning_mapping(
            cfg.get("lulc_source", "nlcd"), cfg.get("manning_mapping"))
        if ctx is not None:
            ctx["_preview_lulc_source"] = out.get("lulc_source", "nlcd")
            ctx["_preview_manning_mapping"] = dict(out["manning_mapping"])
        return out

    def execute(self, ctx_path, ctx, config, log_fn):
        from fimcore.orchestrate import run_lulc_mode

        cfg = self.transform_config(self.merged(config), ctx)
        run_lulc_mode(ctx["project_dir"], [self.feature(ctx)],
                      per_aoi_configs=[cfg], log_fn=log_fn)

    def collect(self, ctx, workdir) -> str:
        from tethysapp.fimsim_gui.job_types.previews import write_manning_preview
        outputs = super().collect(ctx, workdir)
        try:
            write_manning_preview(
                ctx, outputs,
                lulc_source=ctx.get("_preview_lulc_source", "nlcd"),
                manning_mapping=ctx.get("_preview_manning_mapping"))
        except Exception:  # a preview must never fail the step
            pass
        return outputs


class FlowlineToolJobType(ToolMixin, StepJobType):
    """Flowline tool: the NHD main river (highest stream order) and/or the
    full reach set in SHP / GPKG / TIF / CSV, the USGS gages CSV and the
    NWM feature-ID CSV; plus the map preview (main river, saved network,
    gages) for the step."""

    step_key = "flowline_tool"
    clean_patterns = ("main_river_*.*", "all_flowlines_*.*", "usgs_gages_*.csv",
                      "feature_ids_*.csv", "preview_features.geojson")
    OUTPUT_FLAGS = ("save_main_river", "save_all_flowlines",
                    "save_gages_csv", "save_feature_ids")

    def defaults(self) -> dict:
        # desktop aoi_flowline_card defaults
        return {
            "save_main_river": True, "main_format": "shp",
            "save_all_flowlines": False, "all_format": "shp",
            "cell_size_m": 30,            # only for a TIF burn
            "save_gages_csv": True, "save_feature_ids": True,
        }

    def check_values(self, config: dict) -> list:
        problems = []
        for key in self.OUTPUT_FLAGS:
            _check_bool(config, key, problems)
        _check_choice(config, "main_format", FLOWLINE_FORMATS, problems)
        _check_choice(config, "all_format", FLOWLINE_FORMATS, problems)
        _check_number(config, "cell_size_m", MIN_CELL_M, 10000, problems, " m")
        merged = self.merged(config)
        if not any(merged.get(k) is True for k in self.OUTPUT_FLAGS):
            problems.append("select at least one output — the main river, all "
                            "flowlines, the gages CSV or the NWM feature IDs")
        return problems

    def execute(self, ctx_path, ctx, config, log_fn):
        from fimcore.aoi_info import lookup_usgs_gages
        from fimcore.flowline_mode import run_flowline_mode
        from tethysapp.fimsim_gui.job_types.previews import write_flowline_preview

        cfg = self.merged(config)
        feat = self.feature(ctx)
        summary = run_flowline_mode(ctx["project_dir"], [feat],
                                    per_aoi_configs=[cfg], log_fn=log_fn)
        out = summary["features"][0]
        if not out.get("files"):
            raise RuntimeError(
                "the flowline lookup found nothing to save for this area — "
                "no NHD reach crosses it (try a larger rectangle)")
        # the map preview: the saved river / network + the gages, numbered as
        # on the Area step (written into the AOI folder → collect ships it)
        try:
            gages = lookup_usgs_gages(feat.source_file, feat.feature_index, log_fn=log_fn)
        except Exception as exc:  # the preview is optional, the files are not
            log_fn(f"preview: gages skipped ({exc})")
            gages = []
        try:
            write_flowline_preview(
                out.get("_main_river_gdf") if cfg["save_main_river"] else None,
                out.get("_all_flowlines_gdf") if cfg["save_all_flowlines"] else None,
                gages, Path(feat.folder_path) / "preview_features.geojson", log_fn=log_fn)
        except Exception as exc:
            log_fn(f"preview: flowline map skipped ({exc})")


# ── Streamflow tool ──────────────────────────────────────────────────────────

#: NOAA's NWM forecast archive begins here (desktop mode_streamflow note)
NWM_FORECAST_START = datetime(2018, 9, 17)
#: desktop interval combos: USGS 15 min…24 h, NWM retro 30 min…24 h
INTERVALS_H = (0.25, 0.5, 1, 1.0, 3, 3.0, 6, 6.0, 12, 12.0, 24, 24.0)
FORECAST_RANGES = ("short_range", "medium_range", "long_range")
FORECAST_CYCLES = (None, 0, 6, 12, 18)


def split_ids(raw) -> list:
    """'02134170, 02134500' | '1;2\\n3' | [1, ' 2 '] → ['02134170', …]: the
    ID list as typed, split on commas/semicolons/whitespace, blanks dropped.
    (fimcore zero-pads USGS numbers; this only tokenises.)"""
    if raw is None:
        return []
    if isinstance(raw, str):
        parts = raw.replace(",", " ").replace(";", " ").split()
    elif isinstance(raw, (list, tuple)):
        parts = [str(p).strip() for p in raw]
    else:
        parts = [str(raw).strip()]
    return [p for p in parts if p]


class FlowToolJobType(ToolMixin, StepJobType):
    """Streamflow Data tool: NWM retrospective / NWM forecast / USGS gage
    discharge for a typed ID list — one CSV per ID in the AOI folder."""

    step_key = "flow_tool"
    clean_patterns = ("nwm_retro_*.csv", "nwm_forecast_*.csv", "usgs_discharge_*.csv")
    extra_config_keys = ("ids", "start_dt", "end_dt", "forecast_date", "forecast_hour")

    def defaults(self) -> dict:
        return {"source": "nwm_retro", "interval_hours": 1.0,
                "forecast_range": "medium_range"}

    def check_values(self, config: dict) -> list:
        problems = []
        _check_choice(config, "source", ("nwm_retro", "nwm_forecast", "usgs"), problems)
        _check_choice(config, "interval_hours", INTERVALS_H, problems)
        _check_choice(config, "forecast_range", FORECAST_RANGES, problems)
        _check_choice(config, "forecast_hour", FORECAST_CYCLES, problems)
        source = config.get("source", "nwm_retro")
        try:
            sub_hourly = float(config.get("interval_hours", 1)) < 1
        except (TypeError, ValueError):
            sub_hourly = False   # _check_choice already reported it
        if source == "nwm_retro" and sub_hourly:
            problems.append("'interval_hours' must be 1 hour or more for the NWM "
                            "retrospective (it is hourly; 15/30 min apply to USGS gages)")

        ids = split_ids(config.get("ids"))
        if not ids:
            problems.append("'ids' is required — one or more NWM feature IDs or USGS "
                            "gage numbers, comma separated")
        else:
            bad = [i for i in ids if not i.isdigit()]
            if bad:
                problems.append(f"'ids' must be numeric IDs — not: {', '.join(bad[:5])}")
            elif source == "usgs":
                odd = [i for i in ids if not 8 <= len(i) <= 15]
                if odd:
                    problems.append("USGS gage numbers are 8–15 digits "
                                    f"(got {', '.join(odd[:5])})")

        if source == "nwm_forecast":
            fdate = config.get("forecast_date")
            if fdate is None:
                problems.append("'forecast_date' is required — the day the forecast "
                                "was issued (YYYY-MM-DD)")
            else:
                try:
                    issued = datetime.fromisoformat(str(fdate)[:10])
                except ValueError:
                    problems.append(f"'forecast_date' is not a valid date (got {fdate!r})")
                else:
                    today = datetime.now(timezone.utc).replace(tzinfo=None)
                    if issued < NWM_FORECAST_START or issued > today + timedelta(days=1):
                        problems.append("NWM forecasts are archived from 2018-09-17 "
                                        "up to today")
        else:
            _check_window(config, problems, nwm_retro=(source == "nwm_retro"))
        return problems

    def transform_config(self, cfg: dict, ctx) -> dict:
        """JSON config → run_streamflow_mode's config dict (desktop
        gui/mode_streamflow._collect_configs parity)."""
        out = {
            "source": cfg["source"],
            "ids": ", ".join(split_ids(cfg.get("ids"))),
            "interval_hours": float(cfg.get("interval_hours", 1.0)),
        }
        if cfg["source"] == "nwm_forecast":
            issued = datetime.fromisoformat(str(cfg["forecast_date"])[:10])
            out.update({
                "forecast_range": cfg.get("forecast_range", "medium_range"),
                "forecast_date": issued.strftime("%Y-%m-%d"),
                "forecast_hour": cfg.get("forecast_hour"),
                # the forecast defines its own span; these only feed fimcore's
                # coverage note (desktop: issue day + 10 days, hourly)
                "start_dt": issued, "end_dt": issued + timedelta(days=10),
                "interval_hours": 1.0,
            })
        else:
            for key in ("start_dt", "end_dt"):
                if cfg.get(key) is None:
                    raise ValueError(f"Streamflow needs '{key}' (ISO datetime) — "
                                     "the event window is required.")
                out[key] = (datetime.fromisoformat(cfg[key])
                            if isinstance(cfg[key], str) else cfg[key])
        return out

    def execute(self, ctx_path, ctx, config, log_fn):
        from fimcore.run_streamflow import run_streamflow_mode

        cfg = self.transform_config(self.merged(config), ctx)
        folder = ctx["aoi_features"][0]["folder_path"]
        result = run_streamflow_mode(folder, configs=[cfg], log_fn=log_fn)
        for warning in result.get("warnings", []):
            log_fn(f"⚠ {warning}")
        saved = [r for r in result.get("results", []) if r.get("csv_path")]
        if not saved:
            # fimcore logs and continues on an unknown ID / empty window; an
            # empty Downloads step is a failure, with the reason
            raise RuntimeError(
                f"no streamflow data came back for {cfg['ids']} from "
                f"{cfg['source']} — check the IDs and the date window "
                "(the log above has the service's reply)")
