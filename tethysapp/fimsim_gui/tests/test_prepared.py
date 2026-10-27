"""FIMSIM-BE20: listing the user's prepared tool outputs for a modeling step."""
from datetime import datetime, timezone
from types import SimpleNamespace

import numpy as np
import pytest
from shapely.geometry import box

from tethysapp.fimsim_gui.prepared import (
    KIND_STEP, classify, covers, prepared_rows, run_detail,
)

AOI = box(-79.10, 34.60, -78.90, 34.80)          # the modeling area (EPSG:4326)
LATE = datetime(2026, 10, 27, 15, 2, tzinfo=timezone.utc)


def _run(rid, step, files, config=None, project="Lumber prep", aoi="AOI_3_Lumber",
         finished=LATE):
    return SimpleNamespace(
        id=rid, step_key=step, config=config or {}, finished=finished,
        manifest=[{"key": f"admin/35/54/{step}/{f}", "name": f, "bytes": 10} for f in files],
        aoi=SimpleNamespace(name=aoi, project=SimpleNamespace(name=project)))


def _covering(_key):
    return (-79.2, 34.5, -78.8, 34.9)


def test_each_kind_reads_the_matching_tool():
    assert KIND_STEP == {"dem": "dem_tool", "manning": "lulc_tool",
                         "lulc": "lulc_tool", "flow": "flow_tool"}


def test_classify_picks_the_files_of_a_kind_and_skips_the_rest():
    assert classify("DEM_3DEP_A.tif", "dem") == (True, None)
    assert classify("preview_dem.png", "dem") is None
    assert classify("ManningN_A.tif", "manning") == (True, None)
    assert classify("ManningN_A.shp", "manning") is None          # polygonized extra
    assert classify("LULC_A.tif", "manning") is None              # wrong kind
    assert classify("LULC_A.tif", "lulc") == (True, None)
    assert classify("usgs_discharge_02134170.csv", "flow") == (True, None)
    assert classify("nwm_retro_8778193.csv", "flow") == (True, None)


def test_classify_flags_non_geotiff_rasters_and_hand():
    ok, reason = classify("DEM_3DEP_A.asc", "dem")
    assert not ok and "GeoTIFF" in reason
    ok, reason = classify("ManningN_A.gpkg", "manning")
    assert not ok and "GeoTIFF" in reason
    ok, reason = classify("DEM_HAND_A.tif", "dem")
    assert not ok and "not ground elevation" in reason


def test_covers_allows_a_hairline_gap_but_not_a_real_one():
    assert covers((-79.2, 34.5, -78.8, 34.9), AOI)
    # the same area clipped and round-tripped through UTM: a hair short
    assert covers((-79.0999, 34.6001, -78.9001, 34.7999), AOI)
    assert not covers((-79.0, 34.6, -78.9, 34.8), AOI)            # half the area
    assert not covers((-80.0, 35.0, -79.5, 35.5), AOI)            # elsewhere
    assert not covers(None, AOI)


def test_run_detail_names_source_and_cell_size():
    assert run_detail("dem_tool", {"dem_source": "3dep", "dem_res_m": 10}) == "USGS 3DEP · 10 m"
    assert run_detail("lulc_tool", {"lulc_source": "nlcd", "nlcd_year": "2021",
                                    "cell_size_m": 30}) == "NLCD 2021 · 30 m"
    assert run_detail("lulc_tool", {"lulc_source": "sentinel2", "sentinel2_year": 2023,
                                    "cell_size_m": 10}) == "Sentinel-2 2023 · 10 m"
    assert run_detail("flow_tool", {"source": "usgs", "start_dt": "2016-10-01T00:00",
                                    "end_dt": "2016-10-19T23:59"}) \
        == "USGS gage · 2016-10-01 → 2016-10-19"
    assert run_detail("dem_tool", {}) == "USGS 3DEP · 10 m"       # tool defaults fill gaps


def test_rows_one_per_usable_file_newest_first():
    runs = [
        _run(259, "lulc_tool", ["LULC_A.tif", "ManningN_A.tif"],
             {"lulc_source": "nlcd", "nlcd_year": "2021", "cell_size_m": 30}),
        _run(250, "lulc_tool", ["LULC_B.asc", "ManningN_B.asc"], project="Old prep",
             finished=datetime(2026, 10, 20, tzinfo=timezone.utc)),
    ]
    rows = prepared_rows(runs, "manning", AOI, _covering)
    assert [(r["steprun_id"], r["file"]) for r in rows] == [
        (259, "ManningN_A.tif"), (250, "ManningN_B.asc")]
    first = rows[0]
    assert first == {
        "steprun_id": 259, "project": "Lumber prep", "aoi": "AOI_3_Lumber",
        "file": "ManningN_A.tif", "finished": "2026-10-27T15:02:00+00:00",
        "detail": "NLCD 2021 · 30 m", "covers": True, "usable": True, "reason": None,
    }
    assert rows[1]["usable"] is False and rows[1]["covers"] is None


def test_rows_mark_an_uncovered_or_unreadable_raster():
    runs = [_run(1, "dem_tool", ["DEM_3DEP_A.tif"]), _run(2, "dem_tool", ["DEM_3DEP_B.tif"])]

    def bounds(key):
        if key.endswith("A.tif"):
            return (-80.0, 35.0, -79.5, 35.5)
        raise OSError("truncated")

    a, b = prepared_rows(runs, "dem", AOI, bounds)
    assert a["usable"] is True and a["covers"] is False
    assert b["usable"] is False and "could not be read" in b["reason"]


def test_flow_csv_rows_always_cover_and_never_read_bounds():
    def boom(_key):
        raise AssertionError("a CSV has no footprint")

    (row,) = prepared_rows(
        [_run(257, "flow_tool", ["usgs_discharge_02134170.csv"], {"source": "usgs"})],
        "flow", AOI, boom)
    assert row["covers"] is True and row["usable"] is True


def test_gdal_path_never_lets_gdal_probe_a_get_only_url_with_head():
    from tethysapp.fimsim_gui.prepared import gdal_path

    signed = "http://minio:9000/b/k.tif?Signature=a%2Bb&Expires=1"
    s3 = SimpleNamespace(local_path=lambda k: None, internal_url=lambda k: signed)
    p = gdal_path(s3, "k.tif")
    assert p.startswith("/vsicurl?use_head=no&list_dir=no&url=http%3A%2F%2Fminio")
    assert "Signature%3Da%252Bb" in p                 # the signature survives quoting
    local = SimpleNamespace(local_path=lambda k: "/store/k.tif")
    assert gdal_path(local, "k.tif") == "/store/k.tif"


def test_unknown_kind_is_rejected():
    with pytest.raises(ValueError):
        prepared_rows([], "flowline", AOI, _covering)


rasterio = pytest.importorskip("rasterio")


def test_raster_bounds_4326_reads_a_stored_geotiff(tmp_path):
    from rasterio.transform import from_origin

    from tethysapp.fimsim_gui.prepared import raster_bounds_4326
    from tethysapp.fimsim_gui.storage import make_local_service

    storage = make_local_service(tmp_path / "store")
    src = tmp_path / "dem.tif"
    # 10 x 10 cells of 1000 m in UTM 17N, west edge at 680 000 m E
    with rasterio.open(src, "w", driver="GTiff", height=10, width=10, count=1,
                       dtype="float32", crs="EPSG:26917",
                       transform=from_origin(680000, 3850000, 1000, 1000)) as d:
        d.write(np.ones((10, 10), dtype="float32"), 1)
    with open(src, "rb") as fh:
        storage.save("admin/1/2/dem_tool/DEM_3DEP_A.tif", fh)

    w, s, e, n = raster_bounds_4326(storage, "admin/1/2/dem_tool/DEM_3DEP_A.tif")
    assert -79.1 < w < e < -78.9 and 34.6 < s < n < 34.8
