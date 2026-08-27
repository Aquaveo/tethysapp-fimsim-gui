"""FIMSIM-BE6: AOI file ingestion + validation.

Accepts a zipped shapefile, GeoPackage, or GeoJSON; every polygonal feature
becomes its own AOI (desktop inspect_features parity). Invalid geometry is
rejected with a specific message, never repaired. All server-side — the
browser's shpjs parsing was a stopgap and gpkg only works here.
"""
import json
import math
import tempfile
import zipfile
from dataclasses import dataclass, field
from pathlib import Path

MAX_UPLOAD_BYTES = 30 * 1024 * 1024
ACCEPTED_EXTENSIONS = (".zip", ".gpkg", ".geojson", ".json")
CONUS_BOUNDS = (-125.5, 24.0, -66.0, 50.0)


class IngestError(ValueError):
    """User-facing ingestion failure — message is safe to show verbatim."""


@dataclass
class IngestedFeature:
    name: str
    geometry_geojson: dict          # WGS84 Polygon
    area_km2: float
    working_crs_epsg: int
    is_rectangular: bool
    in_conus: bool


@dataclass
class IngestResult:
    features: list = field(default_factory=list)
    skipped_non_polygon: int = 0


def _safe_extract_zip(zpath: Path, dest: Path) -> Path:
    """Zip-slip-safe extraction; returns the .shp path inside."""
    with zipfile.ZipFile(zpath) as zf:
        for member in zf.namelist():
            target = (dest / member).resolve()
            if not str(target).startswith(str(dest.resolve())):
                raise IngestError("Zip archive contains unsafe paths — rejected.")
        zf.extractall(dest)
    shps = sorted(dest.rglob("*.shp"))
    if not shps:
        raise IngestError("The zip archive contains no .shp file.")
    return shps[0]


def _read_gdf(upload_path: Path, original_name: str):
    import geopandas as gpd

    lower = original_name.lower()
    try:
        if lower.endswith(".zip"):
            with tempfile.TemporaryDirectory() as td:
                shp = _safe_extract_zip(upload_path, Path(td))
                return gpd.read_file(shp)
        if lower.endswith((".gpkg", ".geojson", ".json")):
            return gpd.read_file(upload_path)
    except IngestError:
        raise
    except Exception as exc:
        raise IngestError(f"Could not read {original_name}: {exc}")
    raise IngestError(
        "Unsupported file type. Upload a zipped shapefile (.zip), "
        "GeoPackage (.gpkg), or GeoJSON."
    )


def _rectangularity(ring, mid_lat) -> bool:
    """4-corner ring with ~90° corners in a local planar frame — accepts
    rectangles drawn in projected CRSs (matches the FE11 client-side rule)."""
    pts = list(ring)
    if len(pts) >= 2 and pts[0] == pts[-1]:
        pts = pts[:-1]
    if len(pts) != 4:
        return False
    kx = math.cos(math.radians(mid_lat))
    for i in range(4):
        px, py = pts[(i - 1) % 4]
        cx, cy = pts[i]
        nx, ny = pts[(i + 1) % 4]
        a = ((px - cx) * kx, py - cy)
        b = ((nx - cx) * kx, ny - cy)
        la, lb = math.hypot(*a), math.hypot(*b)
        if la == 0 or lb == 0:
            return False
        cosang = max(-1.0, min(1.0, (a[0] * b[0] + a[1] * b[1]) / (la * lb)))
        if abs(math.degrees(math.acos(cosang)) - 90) > 8:
            return False
    return True


def _polygon_checks(geom, name: str):
    from shapely.validation import explain_validity

    if geom.geom_type == "MultiPolygon":
        if len(geom.geoms) != 1:
            raise IngestError(
                f"Feature '{name}' is a MultiPolygon with {len(geom.geoms)} parts — "
                f"split it into one polygon per feature."
            )
        geom = geom.geoms[0]
    if geom.geom_type != "Polygon":
        return None  # non-polygon: skipped, not fatal
    if not geom.is_valid:
        raise IngestError(
            f"Feature '{name}' has invalid geometry "
            f"({explain_validity(geom)}) — fix it in GIS and re-upload."
        )
    if geom.is_empty or geom.area == 0:
        raise IngestError(f"Feature '{name}' has empty geometry.")
    return geom


def ingest_aoi_file(upload_path, original_name: str, size_bytes: int) -> IngestResult:
    from shapely.geometry import mapping

    if size_bytes > MAX_UPLOAD_BYTES:
        raise IngestError(
            f"File is {size_bytes / 1e6:.0f} MB — the limit is "
            f"{MAX_UPLOAD_BYTES / 1e6:.0f} MB. AOI files are boundaries, "
            f"not datasets; simplify the polygon if needed."
        )
    gdf = _read_gdf(Path(upload_path), original_name)
    if gdf.crs is None:
        raise IngestError(
            f"{original_name} has no coordinate reference system defined — "
            f"assign one in GIS and re-upload."
        )
    return ingest_gdf(gdf, default_name=Path(original_name).stem)


def ingest_geojson_geometry(geometry: dict, name: str) -> IngestResult:
    """A drawn AOI: one WGS84 polygon geometry from the browser."""
    import geopandas as gpd
    from shapely.geometry import shape

    try:
        geom = shape(geometry)
    except Exception as exc:
        raise IngestError(f"Unreadable geometry: {exc}")
    gdf = gpd.GeoDataFrame({"name": [name]}, geometry=[geom], crs="EPSG:4326")
    return ingest_gdf(gdf, default_name=name)


def ingest_gdf(gdf, default_name: str) -> IngestResult:
    from fimcore.crs_utils import pick_working_crs_epsg
    from pyproj import Geod
    from shapely.geometry import mapping

    gdf4326 = gdf.to_crs(4326) if (gdf.crs and gdf.crs.to_epsg() != 4326) else gdf
    geod = Geod(ellps="WGS84")
    result = IngestResult()

    name_col = next((c for c in gdf4326.columns
                     if c.lower() in ("name", "aoi_name", "label")), None)

    for i, row in enumerate(gdf4326.itertuples(index=False), start=0):
        raw_name = getattr(row, name_col) if name_col else None
        name = str(raw_name) if raw_name not in (None, "") else (
            default_name if len(gdf4326) == 1 else f"{default_name} — feature {i + 1}"
        )
        geom = _polygon_checks(gdf4326.geometry.iloc[i], name)
        if geom is None:
            result.skipped_non_polygon += 1
            continue

        area_m2, _ = geod.geometry_area_perimeter(geom)
        area_km2 = abs(area_m2) / 1e6
        minx, miny, maxx, maxy = geom.bounds
        in_conus = (minx >= CONUS_BOUNDS[0] and miny >= CONUS_BOUNDS[1]
                    and maxx <= CONUS_BOUNDS[2] and maxy <= CONUS_BOUNDS[3])
        if not in_conus:
            raise IngestError(
                f"Feature '{name}' falls outside the continental US — "
                f"FIMsim's data sources (3DEP, NHD, NWM) are US-only."
            )

        single = gdf4326.iloc[[i]]
        # working CRS honors the ORIGINAL file's projected CRS when metric
        working = pick_working_crs_epsg(gdf.iloc[[i]], log_fn=lambda *_: None)

        result.features.append(IngestedFeature(
            name=name[:200],
            geometry_geojson=mapping(geom),
            area_km2=round(area_km2, 4),
            working_crs_epsg=int(working),
            is_rectangular=_rectangularity(
                geom.exterior.coords, (miny + maxy) / 2),
            in_conus=in_conus,
        ))

    if not result.features:
        raise IngestError(
            "No polygon features found in the file"
            + (f" ({result.skipped_non_polygon} non-polygon feature(s) skipped)."
               if result.skipped_non_polygon else ".")
        )
    return result
