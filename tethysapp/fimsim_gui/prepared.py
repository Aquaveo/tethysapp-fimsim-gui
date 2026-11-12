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
             "lulc": "lulc_tool", "flow": "flow_tool",
             "flowline": "flowline_tool"}   # A2F-2: the A2F Flowline step

# the tool output names (fimcore run_dem_mode / run_lulc_mode / run_streamflow_mode)
_PATTERNS = {
    "dem": re.compile(r"^DEM_(3DEP|HAND)_.+\.(tif|asc|gpkg)$"),
    "manning": re.compile(r"^ManningN_.+\.(tif|asc|gpkg)$"),
    "lulc": re.compile(r"^LULC_.+\.(tif|asc|gpkg)$"),
    "flow": re.compile(r"^(nwm_retro|nwm_forecast|usgs_discharge)_.+\.csv$"),
    "flowline": re.compile(r"^(all_flowlines|main_river)_.+\.(shp|gpkg|csv|tif)$"),
}
#: a shapefile is several files; these travel with the .shp (.cpg optional)
SHAPEFILE_PARTS = (".shx", ".dbf", ".prj")
SHAPEFILE_OPTIONAL = (".cpg",)
#: the reach-id columns fimcore's A2F flowline accepts (arc_flowline._ID_CANDIDATES)
FLOWLINE_ID_COLUMNS = ("comid", "linkno", "featureid", "feature_id", "nhdplusid")
_FORMAT_NAMES = {"asc": "an ESRI ASCII grid", "gpkg": "a GeoPackage"}
_TOOL_NAMES = {"dem": "DEM", "manning": "LULC & Manning", "lulc": "LULC & Manning",
               "flow": "Streamflow Data", "flowline": "Flowline"}
_KIND_NAMES = {"dem": "DEM", "manning": "Manning's n", "lulc": "land-cover",
               "flow": "streamflow", "flowline": "flowline"}
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
    if kind == "flowline":
        return _classify_flowline(m.group(1), ext)
    if ext in _FORMAT_NAMES:
        return False, (f"saved as {_FORMAT_NAMES[ext]} — re-run the "
                       f"{_TOOL_NAMES[kind]} tool with GeoTIFF")
    return True, None


def _classify_flowline(which: str, ext: str):
    if which == "main_river":
        return False, ("the main river has no stream IDs — re-run the Flowline "
                       "tool with \"Save all flowlines\" ticked")
    if ext not in ("shp", "gpkg"):
        return False, (f"saved as {ext.upper()} — re-run the Flowline tool with "
                       f"all flowlines as a Shapefile or GeoPackage")
    return True, None


def covers(bounds, aoi_geom) -> bool:
    """True when the raster's EPSG:4326 *bounds* contain the AOI polygon
    (within COVER_TOLERANCE of its area)."""
    if bounds is None:
        return False
    from shapely.geometry import box
    outside = aoi_geom.difference(box(*bounds)).area
    return outside <= COVER_TOLERANCE * aoi_geom.area


def area_covers(tool_area, aoi_geom) -> bool:
    """True when the tool run's own area polygon contains the AOI (within
    COVER_TOLERANCE). A flowline network is clipped to that polygon — not its
    bounding box — so the polygon is what has to contain this AOI."""
    if tool_area is None:
        return False
    outside = aoi_geom.difference(tool_area).area
    return outside <= COVER_TOLERANCE * aoi_geom.area


NOT_COVERED = ("the prepared file does not cover this area — re-run the "
               "tool on an area that contains it")


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
    if step_key == "flowline_tool":
        return "NHD flowlines"
    source = {"usgs": "USGS gage", "nwm_retro": "NWM retrospective",
              "nwm_forecast": "NWM forecast"}.get(cfg["source"], cfg["source"])
    start, end = cfg.get("start_dt"), cfg.get("end_dt")
    if start and end:
        return f"{source} · {str(start)[:10]} → {str(end)[:10]}"
    return source


def prepared_rows(runs, kind: str, aoi_geom, bounds_fn, tool_area_fn=None) -> list:
    """One row per output file of *kind* across *runs* (succeeded tool runs,
    newest first). *bounds_fn(key)* returns a raster's EPSG:4326 bounds;
    *tool_area_fn(run)* the tool run's own area polygon (flowlines)."""
    if kind not in KIND_STEP:
        raise ValueError(f"unknown kind {kind!r}; one of {', '.join(KIND_STEP)}")
    if kind == "flowline" and tool_area_fn is None:
        raise ValueError("flowlines need tool_area_fn (the tool run's area)")
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
            elif usable and kind == "flowline":
                try:
                    cover = area_covers(tool_area_fn(run), aoi_geom)
                except Exception:
                    usable, reason = False, "the tool run's area could not be read"
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


def shapefile_part_keys(key: str, parts=SHAPEFILE_PARTS + SHAPEFILE_OPTIONAL) -> list:
    """The storage keys of a .shp key's side files (same prefix and stem)."""
    stem = key[:-len(".shp")]
    return [stem + ext for ext in parts]


def _flowline_problem(path, aoi_geom) -> str:
    """Reason a picked flowline can't feed A2F, or None: a readable vector of
    lines with a reach-id column that reaches into this area."""
    import geopandas as gpd

    try:
        gdf = gpd.read_file(path)
    except Exception:
        return "the file could not be read as a vector"
    if gdf.empty or not gdf.geom_type.isin(["LineString", "MultiLineString"]).any():
        return "it has no stream lines"
    if not {c.lower() for c in gdf.columns} & set(FLOWLINE_ID_COLUMNS):
        return ("it has no stream-ID column (COMID, LINKNO or feature_id), "
                "which A2F needs to look up flows")
    if gdf.crs is None:
        return "it has no coordinate system (.prj)"
    try:
        reaches = gdf.to_crs(4326).intersects(aoi_geom).any()
    except Exception:
        return "its geometry could not be reprojected or compared with this area"
    if not reaches:
        return "none of its streams reach this area"
    return None


def _csv_problem(path) -> str:
    import csv
    with open(path, newline="", encoding="utf-8-sig") as fh:
        header = {c.strip().lower() for c in next(csv.reader(fh), [])}
    if not {"time_hours", "discharge_cms"} <= header:
        return "the CSV needs the columns time_hours and discharge_cms"
    return None


def _fetch_parts(storage, src_key: str, dest_key: str, tmp) -> list:
    """Download a picked shapefile's side files next to it; returns the
    (local path, dest key) of each. A missing required part refuses the pick."""
    parts = []
    for src_part, dest_part in zip(shapefile_part_keys(src_key),
                                   shapefile_part_keys(dest_key)):
        if storage.exists(src_part):
            local = Path(tmp) / Path(dest_part).name
            storage.download_to_path(src_part, local)
            parts.append((local, dest_part))
        elif not src_part.endswith(SHAPEFILE_OPTIONAL):
            raise PickError(400, f"'{Path(src_key).name}': its {Path(src_part).suffix} "
                                 f"file is missing — re-run the Flowline tool")
    return parts


def _save_parts(storage, items: list, clear: list) -> None:
    """Store every (local path, key) in *items* as one unit: first remove each
    key in *clear* (a previous pick's parts, e.g. a stale .cpg), and if any save
    fails remove what was written, so a shapefile is never left half-stored."""
    for key in clear:
        if storage.exists(key):
            storage.delete(key)
    written = []
    try:
        for local, key in items:
            with open(local, "rb") as fh:
                storage.save(key, fh)
            written.append(key)
    except Exception as exc:
        for key in written:
            try:
                storage.delete(key)
            except Exception:  # best effort — the pick is already failing
                pass
        raise PickError(503, "the prepared file could not be stored — try again") from exc


def copy_prepared(storage, src_key: str, dest_key: str, kind: str, aoi_geom,
                  tool_area=None) -> dict:
    """Copy a picked file into the modeling AOI's storage after re-checking
    it (a GeoTIFF that covers the area, a CSV with the flow columns, or a
    flowline network whose tool area — *tool_area*, its polygon — contains
    this AOI). A shapefile travels with its side files.
    Returns the upload-shaped {key, name, bytes}; raises PickError."""
    name = Path(dest_key).name
    shapefile = kind == "flowline" and name.endswith(".shp")
    with tempfile.TemporaryDirectory() as tmp:
        local = Path(tmp) / name
        if not storage.exists(src_key):
            raise PickError(404, GONE)
        storage.download_to_path(src_key, local)
        parts = _fetch_parts(storage, src_key, dest_key, tmp) if shapefile else []
        if kind == "flow":
            reason = _csv_problem(local)
        elif kind == "flowline":
            reason = _flowline_problem(local, aoi_geom)
            if reason is None and not area_covers(tool_area, aoi_geom):
                reason = NOT_COVERED
        else:
            from tethysapp.fimsim_gui.dem_upload import validate_geotiff
            reason = validate_geotiff(local)
            if reason is None and not covers(_bounds_4326(local), aoi_geom):
                reason = NOT_COVERED
        if reason:
            raise PickError(400, f"'{name}': {reason}")
        clear = shapefile_part_keys(dest_key) if shapefile else []
        _save_parts(storage, [(local, dest_key)] + parts, clear)
    size = storage.size(dest_key) + sum(storage.size(k) for _l, k in parts)
    return {"key": dest_key, "name": name, "bytes": size}


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
