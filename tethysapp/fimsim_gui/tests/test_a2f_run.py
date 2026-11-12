"""A2F-4: the A2F Run step and the shared depth overlay.

NenCarta never runs here: fimcore's Run orchestrator is replaced by a stub
that writes what the real one leaves behind (FloodMaps/, nencarta.json with
the key, arc_settings_used) — or fails with a message containing the key.
"""
import json

import numpy as np
import pytest
import rasterio
from rasterio.transform import from_origin

from tethysapp.fimsim_gui.job_types import REGISTRY
from tethysapp.fimsim_gui.job_types.previews import write_depth_overlay

KEY = "not-a-real-key-123"
UTM14 = "EPSG:26914"                     # Big Sioux (Test Case 3)


def _depth(rows=40, cols=50):
    d = np.zeros((rows, cols), dtype="float32")
    d[10:20, 10:30] = 2.0                 # 200 wet cells
    d[15, 15] = 6.16                      # Test Case 3's max depth
    return d


def _write_depth(path, depth, nodata=-9999.0):
    d = depth.copy()
    d[d == 0] = nodata
    with rasterio.open(path, "w", driver="GTiff", width=d.shape[1], height=d.shape[0],
                       count=1, dtype="float32", crs=UTM14, nodata=nodata,
                       transform=from_origin(680000, 4830000, 10, 10)) as dst:
        dst.write(d, 1)


# ── the shared overlay (LISFLOOD-FP + A2F) ───────────────────────────────────

def test_depth_overlay_png_and_stats(tmp_path):
    depth = _depth()
    tf = from_origin(680000, 4830000, 10, 10)
    bounds = rasterio.coords.BoundingBox(*rasterio.transform.array_bounds(40, 50, tf))

    stats = write_depth_overlay(depth, tf, UTM14, bounds, tmp_path,
                                extra={"settings_used": "x"})

    assert stats["max_depth_m"] == pytest.approx(6.16)
    assert stats["wet_area_km2"] == pytest.approx(200 * 100 / 1e6)
    assert stats["settings_used"] == "x" and len(stats["corners"]) == 4
    assert -97.5 < stats["bounds"]["west"] < -96 and 43 < stats["bounds"]["south"] < 44
    assert json.loads((tmp_path / "overlay_bounds.json").read_text()) == stats
    with rasterio.open(tmp_path / "max_depth_overlay.png") as png:
        assert png.count == 4 and (png.read(4) > 0).sum() == 200   # dry = transparent


# ── Run step ─────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("name", ["recommended", "classic"])
def test_presets_come_from_fimcore(name):
    from fimcore.arc_presets import preset
    jt = REGISTRY["arun"]
    assert jt.validate_config({"preset": name}) == []
    assert jt.transform_config(jt.merged({"preset": name}), ctx=None) == preset(name)


def test_unknown_preset_is_refused():
    assert REGISTRY["arun"].validate_config({"preset": "joseph_exact"})
    assert REGISTRY["arun"].requires == ("astream",)


def _job(tmp_path, monkeypatch):
    import fimcore.nencarta_run as nr
    monkeypatch.setattr(nr, "flood_mapping_cli", lambda: "/usr/bin/flood-mapping")
    monkeypatch.setenv("FIMSIM_NWM_API_KEY", KEY)
    folder = tmp_path / "T2_04"
    folder.mkdir()
    ctx_path = tmp_path / "workflow_context.json"
    return folder, ctx_path, {"aoi_features": [{"folder_path": str(folder)}]}


def _fake_nencarta(folder, ctx_path, *, maps=True, fail=False):
    def run(path, ctx, per_aoi_configs=None, log_fn=None):
        (ctx_path.parent / "nencarta.json").write_text(json.dumps({"nwm_api_key": KEY}))
        (folder / "nencarta_fallback1.json").write_text(json.dumps({"nwm_api_key": KEY}))
        (folder / "workflow_context.json").write_text(json.dumps({
            "nencarta_streamflow": {"nwm_api_key": KEY},
            "arc_settings_used": "the FIMsim classic settings"}))
        log_fn(f"GET https://nwm-api.ciroh.org/return-period?key={KEY}")
        if fail:
            raise RuntimeError(f"HTTP 500 from ...?key={KEY}")
        if maps:
            (folder / "FloodMaps").mkdir()
            _write_depth(folder / "FloodMaps" / "depth_2019-09-19_1700.tif", _depth())
            _write_depth(folder / "FloodMaps" / "FIM_2019-09-19_1700.tif",
                         (_depth() > 0).astype("float32"))
    return run


def test_run_collects_maps_overlay_and_which_settings_ran(tmp_path, monkeypatch):
    import fimcore.arc_orchestrate as arc
    folder, ctx_path, ctx = _job(tmp_path, monkeypatch)
    monkeypatch.setattr(arc, "run_arc_curve2flood_for_all_aois",
                        _fake_nencarta(folder, ctx_path))
    log = []

    REGISTRY["arun"].execute(str(ctx_path), ctx, {"preset": "recommended"}, log.append)
    (tmp_path / "work").mkdir()
    out = tmp_path / "work" / "outputs"
    REGISTRY["arun"].collect(ctx, tmp_path / "work")

    assert {p.name for p in out.iterdir()} == {
        "depth_2019-09-19_1700.tif", "FIM_2019-09-19_1700.tif",
        "max_depth_overlay.png", "overlay_bounds.json"}
    stats = json.loads((out / "overlay_bounds.json").read_text())
    assert stats["settings_used"] == "the FIMsim classic settings"
    assert stats["max_depth_m"] == pytest.approx(6.16)
    assert KEY not in "\n".join(log) and "key=***" in "\n".join(log)


@pytest.mark.parametrize("fail", [False, True])
def test_the_key_is_gone_after_the_run_even_when_it_fails(tmp_path, monkeypatch, fail):
    import fimcore.arc_orchestrate as arc
    folder, ctx_path, ctx = _job(tmp_path, monkeypatch)
    monkeypatch.setattr(arc, "run_arc_curve2flood_for_all_aois",
                        _fake_nencarta(folder, ctx_path, fail=fail))

    try:
        REGISTRY["arun"].execute(str(ctx_path), ctx, {"preset": "recommended"},
                                 lambda *a: None)
    except RuntimeError as exc:
        assert fail and KEY not in str(exc) and exc.__cause__ is None

    leftovers = [p for p in tmp_path.rglob("*") if p.is_file() and KEY in p.read_text(
        errors="ignore")]
    assert leftovers == []
    assert not list(tmp_path.rglob("nencarta*.json"))


def test_no_depth_map_fails_the_step_with_a_reason(tmp_path, monkeypatch):
    import fimcore.arc_orchestrate as arc
    folder, ctx_path, ctx = _job(tmp_path, monkeypatch)
    monkeypatch.setattr(arc, "run_arc_curve2flood_for_all_aois",
                        _fake_nencarta(folder, ctx_path, maps=False))

    with pytest.raises(RuntimeError, match="no flood depth map"):
        REGISTRY["arun"].execute(str(ctx_path), ctx, {"preset": "recommended"},
                                 lambda *a: None)


def test_a_worker_without_nencarta_says_how_to_fix_it(tmp_path, monkeypatch):
    import fimcore.nencarta_run as nr
    _folder, ctx_path, ctx = _job(tmp_path, monkeypatch)
    monkeypatch.setattr(nr, "flood_mapping_cli", lambda: None)

    with pytest.raises(RuntimeError, match="flood-mapping command is not installed"):
        REGISTRY["arun"].execute(str(ctx_path), ctx, {"preset": "classic"},
                                 lambda *a: None)
