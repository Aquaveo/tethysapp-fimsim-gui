"""Preview emitters (visuals plan): synthetic rasters in, PNG + JSON out.
The class-breakdown percentages are pinned exactly — they are BE12's
user-facing coverage numbers, computed the desktop's way (pixel counts)."""
import json
from pathlib import Path

import numpy as np
import pytest

rasterio = pytest.importorskip("rasterio")

from tethysapp.fimsim_gui.job_types.previews import (  # noqa: E402
    write_dem_preview, write_manning_preview,
)

# EPSG:26917, 30 m cells, in the Neuse neighborhood
TRANSFORM = rasterio.transform.from_origin(762300, 3927100, 30, 30)


def _write_tif(path, arr, nodata=None):
    with rasterio.open(
            path, "w", driver="GTiff", width=arr.shape[1], height=arr.shape[0],
            count=1, dtype=arr.dtype, crs="EPSG:26917", transform=TRANSFORM,
            nodata=nodata) as dst:
        dst.write(arr, 1)


def _ctx(folder: Path) -> dict:
    return {"aoi_features": [{"folder_path": str(folder)}]}


def test_dem_preview_png_bounds_and_stats(tmp_path):
    dem = np.linspace(10, 60, 40 * 50).reshape(40, 50).astype("float32")
    dem[0, 0] = -9999.0
    _write_tif(tmp_path / "DEM_Test.tif", dem, nodata=-9999.0)
    out = tmp_path / "outputs"
    out.mkdir()

    assert write_dem_preview(_ctx(tmp_path), out)
    meta = json.loads((out / "preview_dem.json").read_text())
    assert meta["kind"] == "dem"
    # UTM 17N around the Neuse → roughly (-78.1, 35.4)
    assert -79 < meta["bounds"]["west"] < -77
    assert 35 < meta["bounds"]["south"] < 36
    assert meta["stats"]["min_m"] >= 10
    assert meta["stats"]["max_m"] <= 60
    assert len(meta["legend"]["ramp"]) == 12
    with rasterio.open(out / "preview_dem.png") as png:
        assert png.count == 4
        alpha = png.read(4)
        assert alpha[0, 0] == 0          # nodata transparent
        assert alpha[-1, -1] == 255
    assert not list(out.glob("*.aux.xml"))  # sidecars never ship


def test_manning_preview_class_table_percentages(tmp_path):
    # Sentinel-2 codes: 60% water(1), 40% trees(2)
    lulc = np.full((10, 10), 1, dtype="int32")
    lulc[:, 6:] = 2
    _write_tif(tmp_path / "LULC_Test_2023.tif", lulc)
    n = np.where(lulc == 1, 0.030, 0.110).astype("float32")
    _write_tif(tmp_path / "ManningN_Test.tif", n)
    out = tmp_path / "outputs"
    out.mkdir()

    assert write_manning_preview(_ctx(tmp_path), out, lulc_source="esri",
                                 manning_mapping={"2": 0.2})
    meta = json.loads((out / "preview_lulc.json").read_text())
    classes = {c["code"]: c for c in meta["classes"]}
    assert classes[1]["pct"] == 60.0 and classes[2]["pct"] == 40.0
    assert classes[1]["name"] == "Water"
    # 30 m cells → 60 px × 900 m² = 0.054 km²
    assert classes[1]["area_km2"] == pytest.approx(0.054)
    assert classes[1]["n"] == 0.030          # table default
    assert classes[2]["n"] == 0.2            # user's mapping wins
    assert meta["classes"][0]["code"] == 1   # sorted by dominance
    assert meta["has_manning"]
    assert (out / "preview_lulc.png").exists()
    assert (out / "preview_manning.png").exists()


def test_nlcd_source_uses_the_nlcd_table(tmp_path):
    lulc = np.full((5, 5), 11, dtype="int32")  # NLCD 11 = Open Water
    _write_tif(tmp_path / "LULC_Test_2021.tif", lulc)
    out = tmp_path / "outputs"
    out.mkdir()
    write_manning_preview(_ctx(tmp_path), out, lulc_source="nlcd")
    meta = json.loads((out / "preview_lulc.json").read_text())
    assert meta["classes"][0]["name"] == "Open Water"


def test_wgs84_corners_are_the_four_reprojected_corners(tmp_path):
    # FIMSIM-FE33: corners preserve the raster quad (TL,TR,BR,BL) vs the
    # flattened W/S/E/N envelope.
    import numpy as np
    import rasterio
    from rasterio.transform import from_origin
    from pyproj import Transformer
    from tethysapp.fimsim_gui.job_types.previews import _wgs84_corners, _wgs84_bounds

    tif = tmp_path / "r.tif"
    # UTM 15N raster: origin (west=200000, north=3300000), 10 m cells, 100x80
    with rasterio.open(tif, "w", driver="GTiff", height=80, width=100, count=1,
                       dtype="float32", crs="EPSG:26915",
                       transform=from_origin(200000, 3300000, 10, 10)) as d:
        d.write(np.ones((80, 100), dtype="float32"), 1)

    with rasterio.open(tif) as src:
        corners = _wgs84_corners(src)
        bounds = _wgs84_bounds(src)
        left, bottom, right, top = src.bounds

    tf = Transformer.from_crs("EPSG:26915", "EPSG:4326", always_xy=True)
    expect = [list(tf.transform(x, y)) for x, y in
              ((left, top), (right, top), (right, bottom), (left, bottom))]
    assert len(corners) == 4
    for got, exp in zip(corners, expect):
        assert abs(got[0] - exp[0]) < 1e-9 and abs(got[1] - exp[1]) < 1e-9
    # order sanity: TL north == TR north's row, BL south, etc. (all within env)
    for lon, lat in corners:
        assert bounds["west"] - 1e-6 <= lon <= bounds["east"] + 1e-6
        assert bounds["south"] - 1e-6 <= lat <= bounds["north"] + 1e-6
