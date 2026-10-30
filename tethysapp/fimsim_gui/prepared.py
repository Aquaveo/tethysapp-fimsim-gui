"""FIMSIM-BE20: the user's prepared tool outputs a modeling step can pick.

Round 2 of Preparing Input Data (docs/design-input-prep-round2.md): Terrain,
Roughness and Flow Data list the files the DEM, LULC & Manning and Streamflow
Data tools produced, from any of the user's projects. Pure helpers here; the
controller supplies the runs, the modeling AOI's geometry and a bounds reader.
"""
import re
import tempfile
from pathlib import Path

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
_TOOL_NAMES = {"dem": "DEM", "manning": "LULC & Manning", "lulc": "LULC & Manning",
               "flow": "Streamflow Data"}
_KIND_NAMES = {"dem": "DEM", "manning": "Manning's n", "lulc": "land-cover",
               "flow": "streamflow"}
GONE = "that prepared run no longer exists — refresh the list"


class PickError(Exception):
    """A refused pick: the HTTP status and the message the step shows."""

    def __init__(self, status: int, message: str):
        super().__init__(status, message)
        self.status, self.message = status, message


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


def check_pick(run, username: str, file: str, kind: str) -> str:
    """FIMSIM-BE21: the storage key of *file* in tool *run* if the user may
    pick it as a *kind* input; raises PickError otherwise."""
    if kind not in KIND_STEP:
        raise ValueError(f"unknown kind {kind!r}; one of {', '.join(KIND_STEP)}")
    if run is None:
        raise PickError(404, GONE)
    if run.aoi.project.username != username:
        raise PickError(403, "access denied")
    if run.step_key != KIND_STEP[kind]:
        raise PickError(400, f"run {run.id} is not a {_TOOL_NAMES[kind]} tool run")
    if run.status != "succeeded" or run.superseded:
        raise PickError(404, GONE)
    entry = next((m for m in run.manifest or [] if m["name"] == file), None)
    if entry is None:
        raise PickError(400, f"'{file}' is not an output of that run")
    verdict = classify(file, kind)
    if verdict is None:
        raise PickError(400, f"'{file}' is not a {_KIND_NAMES[kind]} file")
    if not verdict[0]:
        raise PickError(400, verdict[1])
    return entry["key"]


def _csv_problem(path) -> str:
    import csv
    with open(path, newline="", encoding="utf-8-sig") as fh:
        header = {c.strip().lower() for c in next(csv.reader(fh), [])}
    if not {"time_hours", "discharge_cms"} <= header:
        return "the CSV needs the columns time_hours and discharge_cms"
    return None


def copy_prepared(storage, src_key: str, dest_key: str, kind: str, aoi_geom) -> dict:
    """Copy a picked file into the modeling AOI's storage after re-checking
    it (a GeoTIFF that covers the area, or a CSV with the flow columns).
    Returns the upload-shaped {key, name, bytes}; raises PickError."""
    name = Path(dest_key).name
    with tempfile.TemporaryDirectory() as tmp:
        local = Path(tmp) / name
        if not storage.exists(src_key):
            raise PickError(404, GONE)
        storage.download_to_path(src_key, local)
        if kind == "flow":
            reason = _csv_problem(local)
        else:
            from tethysapp.fimsim_gui.dem_upload import validate_geotiff
            reason = validate_geotiff(local)
            if reason is None and not covers(_bounds_4326(local), aoi_geom):
                reason = ("the prepared file does not cover this area — re-run the "
                          "tool on an area that contains it")
        if reason:
            raise PickError(400, f"'{name}': {reason}")
        with open(local, "rb") as fh:
            storage.save(dest_key, fh)
    return {"key": dest_key, "name": name, "bytes": storage.size(dest_key)}


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


def _bounds_4326(path):
    import rasterio
    from rasterio.warp import transform_bounds

    with rasterio.open(path) as src:
        return transform_bounds(src.crs, "EPSG:4326", *src.bounds, densify_pts=21)


def raster_bounds_4326(storage, key):
    """A stored raster's bounds in EPSG:4326, reading only its header."""
    return _bounds_4326(gdal_path(storage, key))
