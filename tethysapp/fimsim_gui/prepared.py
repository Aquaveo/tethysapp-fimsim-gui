"""FIMSIM-BE20: the user's prepared tool outputs a modeling step can pick.

Round 2 of Preparing Input Data (docs/design-input-prep-round2.md): Terrain,
Roughness and Flow Data list the files the DEM, LULC & Manning and Streamflow
Data tools produced, from any of the user's projects. Pure helpers here; the
controller supplies the runs, the modeling AOI's geometry and a bounds reader.
"""
import re

# what each modeling input is picked from
KIND_STEP = {"dem": "dem_tool", "manning": "lulc_tool",
             "lulc": "lulc_tool", "flow": "flow_tool"}

# the tool output names (fimcore run_dem_mode / run_lulc_mode / run_streamflow_mode)
_PATTERNS = {
    "dem": re.compile(r"^DEM_(3DEP|HAND)_.+\.(tif|asc|gpkg)$"),
    "manning": re.compile(r"^ManningN_.+\.(tif|asc|gpkg)$"),
    "lulc": re.compile(r"^LULC_.+\.(tif|asc|gpkg)$"),
    "flow": re.compile(r"^(nwm_retro|nwm_forecast|usgs_discharge)_.+\.csv$"),
}
_FORMAT_NAMES = {"asc": "an ESRI ASCII grid", "gpkg": "a GeoPackage"}
_TOOL_NAMES = {"dem": "DEM", "manning": "LULC & Manning", "lulc": "LULC & Manning"}

# a raster covers the area when at most this share of the AOI falls outside
# it (a tool clips to its own AOI and round-trips through UTM, so the same
# area comes back a hair short of its own polygon)
COVER_TOLERANCE = 0.01


def classify(name: str, kind: str):
    """(usable, reason) for a tool output file of *kind*; None if it isn't one."""
    m = _PATTERNS[kind].match(name)
    if m is None:
        return None
    if kind == "dem" and m.group(1) == "HAND":
        return False, ("HAND is height above the nearest stream, not ground "
                       "elevation — use a USGS 3DEP DEM for Terrain")
    ext = name.rsplit(".", 1)[1]
    if ext in _FORMAT_NAMES:
        return False, (f"saved as {_FORMAT_NAMES[ext]} — re-run the "
                       f"{_TOOL_NAMES[kind]} tool with GeoTIFF")
    return True, None


def covers(bounds, aoi_geom) -> bool:
    """True when the raster's EPSG:4326 *bounds* contain the AOI polygon
    (within COVER_TOLERANCE of its area)."""
    if bounds is None:
        return False
    from shapely.geometry import box
    outside = aoi_geom.difference(box(*bounds)).area
    return outside <= COVER_TOLERANCE * aoi_geom.area


def run_detail(step_key: str, config: dict) -> str:
    """One line naming the run's source and cell size (or window)."""
    from tethysapp.fimsim_gui.job_types import REGISTRY
    cfg = {**REGISTRY[step_key].defaults(), **(config or {})}
    if step_key == "dem_tool":
        source = "USGS 3DEP" if cfg["dem_source"] == "3dep" else "HAND"
        return f"{source} · {cfg['dem_res_m']:g} m"
    if step_key == "lulc_tool":
        if cfg["lulc_source"] == "nlcd":
            source = f"NLCD {cfg['nlcd_year']}"
        else:
            source = f"Sentinel-2 {cfg['sentinel2_year']}"
        return f"{source} · {cfg['cell_size_m']:g} m"
    source = {"usgs": "USGS gage", "nwm_retro": "NWM retrospective",
              "nwm_forecast": "NWM forecast"}.get(cfg["source"], cfg["source"])
    start, end = cfg.get("start_dt"), cfg.get("end_dt")
    if start and end:
        return f"{source} · {str(start)[:10]} → {str(end)[:10]}"
    return source


def prepared_rows(runs, kind: str, aoi_geom, bounds_fn) -> list:
    """One row per output file of *kind* across *runs* (succeeded tool runs,
    newest first). *bounds_fn(key)* returns a raster's EPSG:4326 bounds."""
    if kind not in KIND_STEP:
        raise ValueError(f"unknown kind {kind!r}; one of {', '.join(KIND_STEP)}")
    rows = []
    for run in sorted(runs, key=lambda r: r.finished, reverse=True):
        detail = run_detail(run.step_key, run.config)
        for m in run.manifest or []:
            verdict = classify(m["name"], kind)
            if verdict is None:
                continue
            usable, reason = verdict
            cover = None
            if usable and kind == "flow":
                cover = True               # a flow series has no footprint
            elif usable:
                try:
                    cover = covers(bounds_fn(m["key"]), aoi_geom)
                except Exception:
                    usable, reason = False, "the file could not be read"
            rows.append({
                "steprun_id": run.id,
                "project": run.aoi.project.name,
                "aoi": run.aoi.name,
                "file": m["name"],
                "finished": run.finished.isoformat() if run.finished else None,
                "detail": detail,
                "covers": cover,
                "usable": usable,
                "reason": reason,
            })
    return rows


def gdal_path(storage, key) -> str:
    """Where GDAL reads a stored object from without downloading it: the
    local path, or the server-side presigned GET through /vsicurl. The URL is
    signed for GET only, so GDAL must not probe it with HEAD (MinIO answers
    403) — use_head=no."""
    path = storage.local_path(key)
    if path is not None:
        return path
    from urllib.parse import quote
    return ("/vsicurl?use_head=no&list_dir=no&url="
            + quote(storage.internal_url(key), safe=""))


def raster_bounds_4326(storage, key):
    """A stored raster's bounds in EPSG:4326, reading only its header."""
    import rasterio
    from rasterio.warp import transform_bounds

    with rasterio.open(gdal_path(storage, key)) as src:
        return transform_bounds(src.crs, "EPSG:4326", *src.bounds, densify_pts=21)
