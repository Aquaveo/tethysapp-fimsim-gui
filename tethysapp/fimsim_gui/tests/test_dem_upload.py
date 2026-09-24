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


# ── BE17 slice 2: ownership guard, staging, config contract ──────────────────

def test_rejected_dem_keys_flags_foreign_prefixes():
    from tethysapp.fimsim_gui.dem_upload import rejected_dem_keys
    prefix = "admin/3/7/user_dem/"
    assert rejected_dem_keys(["admin/3/7/user_dem/a.tif"], prefix) == []
    assert rejected_dem_keys(
        ["admin/3/9/user_dem/a.tif"], prefix) == ["admin/3/9/user_dem/a.tif"]
    assert rejected_dem_keys(None, prefix) == []


def test_dem_prestage_stages_keys_to_user_dem_path(tmp_path):
    from tethysapp.fimsim_gui.job_types import REGISTRY

    class FakeStorage:
        def download_to_path(self, key, dest):
            from pathlib import Path
            Path(dest).parent.mkdir(parents=True, exist_ok=True)
            Path(dest).write_text("dem-bytes")

    feat_dir = tmp_path / "aoi1"
    feat_dir.mkdir()
    ctx = {"aoi_features": [{"folder_path": str(feat_dir)}]}
    cfg = {"user_dem_keys": ["u/1/1/user_dem/a.tif", "u/1/1/user_dem/b.tif"]}
    REGISTRY["dem"].prestage_inputs(FakeStorage(), ctx, cfg, lambda *a: None)
    import os
    assert len(cfg["user_dem_path"]) == 2
    assert all(os.path.exists(p) for p in cfg["user_dem_path"])
    # no keys → hook is a no-op, no user_dem_path injected
    cfg2 = {}
    REGISTRY["dem"].prestage_inputs(FakeStorage(), ctx, cfg2, lambda *a: None)
    assert "user_dem_path" not in cfg2


def test_dem_config_contract():
    from tethysapp.fimsim_gui.job_types import REGISTRY
    # a client may name uploaded keys...
    assert REGISTRY["dem"].validate_config({"user_dem_keys": ["x"]}) == []
    assert REGISTRY["tdem"].validate_config({"user_dem_keys": ["x"]}) == []
    # ...but never a raw worker path (server-only, also for the TRITON step)
    assert "user_dem_path" in REGISTRY["dem"].server_only_keys
    assert "user_dem_path" in REGISTRY["tdem"].server_only_keys
