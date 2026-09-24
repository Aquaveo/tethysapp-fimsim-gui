"""FIMSIM-BE17: user-supplied DEM uploads.

The desktop lets a user bring their own DEM GeoTIFF(s) instead of downloading
3DEP (merged if more than one). This module validates an uploaded GeoTIFF before
it is stored; the DEM/tdem job stages the stored file(s) into the worker
workspace and passes them to fimcore as ``user_dem_path`` with ``has_dem=True``.
"""
from pathlib import Path


def validate_dem_geotiff(path) -> str:
    """Reason an uploaded DEM is unusable, or None if it's a valid GeoTIFF.

    Mirrors fimcore._validate_raster: readable raster, at least one band, a CRS
    defined (fimcore reprojects/merges to the AOI grid, but it needs a CRS to
    start from).
    """
    import rasterio

    p = Path(path)
    if not p.exists():
        return "the uploaded file could not be read"
    try:
        with rasterio.open(p) as src:
            if src.count < 1:
                return "not a valid raster — the file has no bands"
            if src.crs is None:
                return ("the GeoTIFF has no coordinate reference system — assign "
                        "a CRS in a GIS tool before uploading")
    except Exception as exc:  # rasterio raises many subtypes on a bad file
        return f"could not read the file as a GeoTIFF ({type(exc).__name__})"
    return None
