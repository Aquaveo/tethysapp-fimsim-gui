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


def _png_rgb_at(png_path, row, col):
    with rasterio.open(png_path) as png:
        return tuple(int(png.read(b + 1)[row, col]) for b in range(3))


def test_lulc_map_uses_official_source_palette(tmp_path):
    # FIMSIM-FE/#5: the LULC map (not the Manning map) is coloured from the
    # official source legend by class code — Esri Sentinel-2 here.
    lulc = np.full((8, 8), 1, dtype="int32")   # Water
    lulc[:, 4:] = 2                            # Trees
    _write_tif(tmp_path / "LULC_Test_2023.tif", lulc)
    n = np.where(lulc == 1, 0.030, 0.110).astype("float32")
    _write_tif(tmp_path / "ManningN_Test.tif", n)
    out = tmp_path / "outputs"
    out.mkdir()

    write_manning_preview(_ctx(tmp_path), out, lulc_source="esri")
    classes = {c["code"]: c for c in
               json.loads((out / "preview_lulc.json").read_text())["classes"]}
    assert classes[1]["color"] == "#419bdf"   # Esri Water
    assert classes[2]["color"] == "#397d49"   # Esri Trees
    # the PNG pixels carry the same official colours
    assert _png_rgb_at(out / "preview_lulc.png", 0, 0) == (0x41, 0x9b, 0xdf)
    assert _png_rgb_at(out / "preview_lulc.png", 0, 7) == (0x39, 0x7d, 0x49)
    # the Manning map is NOT the LULC palette — it keeps its own ramp
    assert _png_rgb_at(out / "preview_manning.png", 0, 0) != (0x41, 0x9b, 0xdf)


def test_lulc_map_uses_official_nlcd_palette(tmp_path):
    lulc = np.full((5, 5), 11, dtype="int32")  # NLCD Open Water
    lulc[:, 3:] = 42                            # Evergreen Forest
    _write_tif(tmp_path / "LULC_Test_2021.tif", lulc)
    out = tmp_path / "outputs"
    out.mkdir()
    write_manning_preview(_ctx(tmp_path), out, lulc_source="nlcd")
    classes = {c["code"]: c for c in
               json.loads((out / "preview_lulc.json").read_text())["classes"]}
    assert classes[11]["color"] == "#466b9f"   # MRLC Open Water
    assert classes[42]["color"] == "#1c5f2c"   # MRLC Evergreen Forest


def test_dem_preview_reads_an_ascii_grid(tmp_path):
    # FIMSIM-BE25: the DEM tool may write only a .asc/.gpkg (fimcore deletes
    # the intermediate GeoTIFF) — the terrain preview must still appear
    dem = np.linspace(20, 50, 20 * 25).reshape(20, 25).astype("float32")
    with rasterio.open(
            tmp_path / "DEM_3DEP_Test.asc", "w", driver="AAIGrid", width=25, height=20,
            count=1, dtype="float32", crs="EPSG:26917", transform=TRANSFORM,
            nodata=-9999.0) as dst:
        dst.write(dem, 1)
    out = tmp_path / "outputs"
    out.mkdir()
    assert write_dem_preview(_ctx(tmp_path), out)
    meta = json.loads((out / "preview_dem.json").read_text())
    assert 20 <= meta["stats"]["min_m"] and meta["stats"]["max_m"] <= 50
    assert -79 < meta["bounds"]["west"] < -77        # the .prj sidecar carried the CRS


def test_flowline_preview_kinds_and_wgs84(tmp_path):
    gpd = pytest.importorskip("geopandas")
    from shapely.geometry import LineString
    from tethysapp.fimsim_gui.job_types.previews import write_flowline_preview

    # EPSG:26917 lines near the Neuse (same neighbourhood as TRANSFORM)
    main = gpd.GeoDataFrame({"COMID": [8781135]},
                            geometry=[LineString([(762300, 3927100), (763300, 3926100)])],
                            crs="EPSG:26917")
    net = gpd.GeoDataFrame({"COMID": [1, 2]}, geometry=[
        LineString([(762000, 3927000), (762500, 3927500)]),
        LineString([(763000, 3927000), (763500, 3927500)])], crs="EPSG:26917")
    gages = [{"site_no": "02134170", "station_nm": "LUMBER RIVER", "lat": 35.4, "lon": -78.1},
             {"site_no": "0000", "station_nm": "no coords", "lat": None, "lon": None}]
    out = write_flowline_preview(main, net, gages, tmp_path / "preview_features.geojson")
    fc = json.loads(out.read_text())
    kinds = [f["properties"]["kind"] for f in fc["features"]]
    assert kinds.count("flowline") == 2 and kinds.count("main_river") == 1
    assert kinds.count("gage") == 1                       # the one without coords is skipped
    gage = next(f for f in fc["features"] if f["properties"]["kind"] == "gage")
    assert gage["properties"] == {"kind": "gage", "num": "1", "site_no": "02134170",
                                  "name": "LUMBER RIVER"}
    river = next(f for f in fc["features"] if f["properties"]["kind"] == "main_river")
    lon, lat = river["geometry"]["coordinates"][0]
    assert -79 < lon < -77 and 35 < lat < 36             # reprojected to WGS84
    assert fc["style"]["main_river"]["color"] == "#2b6cb0"


def test_flowline_preview_with_nothing_to_draw_writes_nothing(tmp_path):
    from tethysapp.fimsim_gui.job_types.previews import write_flowline_preview
    assert write_flowline_preview(None, None, [], tmp_path / "p.geojson") is None
    assert not (tmp_path / "p.geojson").exists()


def test_uint8_lulc_with_nodata_gets_its_previews(tmp_path):
    # the LULC & Manning tool saves NLCD as uint8 with nodata outside the
    # AOI; filling the mask with -1 overflowed uint8 and the swallowed error
    # left the tool run with no previews (2026-10-29, run 260)
    lulc = np.full((5, 5), 41, dtype="uint8")  # NLCD 41 = Deciduous Forest
    lulc[0, :] = 0
    _write_tif(tmp_path / "LULC_AOI_3_Lumber.tif", lulc, nodata=0)
    _write_tif(tmp_path / "ManningN_AOI_3_Lumber.tif",
               np.full((5, 5), 0.1, dtype="float32"), nodata=-9999)
    out = tmp_path / "outputs"
    out.mkdir()
    assert write_manning_preview(_ctx(tmp_path), out, lulc_source="nlcd")
    meta = json.loads((out / "preview_lulc.json").read_text())
    assert [c["code"] for c in meta["classes"]] == [41]
    assert (out / "preview_lulc.png").exists()
    assert (out / "preview_manning.png").exists()
