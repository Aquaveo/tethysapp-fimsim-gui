"""FIMSIM-BE17: user-DEM upload validation."""
import numpy as np
import pytest

rasterio = pytest.importorskip("rasterio")
from rasterio.transform import from_origin  # noqa: E402

from tethysapp.fimsim_gui.dem_upload import validate_dem_geotiff  # noqa: E402


def _write_tif(path, crs="EPSG:26917"):
    kw = dict(driver="GTiff", height=4, width=4, count=1, dtype="float32",
              transform=from_origin(0, 10, 1, 1))
    if crs:
        kw["crs"] = crs
    with rasterio.open(path, "w", **kw) as d:
        d.write(np.ones((4, 4), dtype="float32"), 1)


def test_valid_geotiff_passes(tmp_path):
    good = tmp_path / "dem.tif"
    _write_tif(good)
    assert validate_dem_geotiff(str(good)) is None


def test_geotiff_without_crs_is_rejected(tmp_path):
    nocrs = tmp_path / "nocrs.tif"
    _write_tif(nocrs, crs=None)
    assert "coordinate reference system" in validate_dem_geotiff(str(nocrs))


def test_non_raster_is_rejected(tmp_path):
    bad = tmp_path / "notes.txt"
    bad.write_text("not a raster")
    assert validate_dem_geotiff(str(bad)) is not None


def test_missing_file_is_rejected(tmp_path):
    assert validate_dem_geotiff(str(tmp_path / "nope.tif")) is not None
