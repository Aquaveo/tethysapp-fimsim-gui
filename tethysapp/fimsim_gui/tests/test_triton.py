"""TRITON job-type specifics: the scratch project must be stamped as TRITON
(or fimcore's shared steps write the LISFLOOD layout — the dem.asc bug found
live on 2026-09-10), collect must ship triton-files/, and the BC step must
fill its per-type default value."""
import json
from pathlib import Path

from tethysapp.fimsim_gui.job_types import REGISTRY


def _square_aoi_geojson(tmp_path: Path) -> Path:
    ring = [[-78.11, 35.29], [-77.93, 35.29], [-77.93, 35.45],
            [-78.11, 35.45], [-78.11, 35.29]]
    fc = {"type": "FeatureCollection",
          "features": [{"type": "Feature", "properties": {"name": "sq"},
                        "geometry": {"type": "Polygon", "coordinates": [ring]}}]}
    p = tmp_path / "aoi.geojson"
    p.write_text(json.dumps(fc))
    return p


def test_prepare_stamps_the_project_as_triton(tmp_path):
    ctx_path, ctx = REGISTRY["tdem"].prepare(
        tmp_path, _square_aoi_geojson(tmp_path), lambda *_: None)
    assert ctx.get("triton_dir")            # fimcore keys the layout off this
    assert "lisflood_dir" not in ctx
    # and it round-trips through the saved ctx file (workers re-read it)
    saved = json.loads(Path(ctx_path).read_text())
    assert saved.get("triton_dir")


def test_lisflood_prepare_is_untouched(tmp_path):
    _, ctx = REGISTRY["dem"].prepare(
        tmp_path, _square_aoi_geojson(tmp_path), lambda *_: None)
    assert ctx.get("lisflood_dir")
    assert not ctx.get("triton_dir")


def test_collect_ships_the_triton_deck_not_the_lisflood_one(tmp_path):
    feat = tmp_path / "Neuse"
    (feat / "triton-files").mkdir(parents=True)
    (feat / "lisflood-files").mkdir()
    (feat / "triton-files" / "dem.asc").write_text("x")
    (feat / "triton-files" / "model.cfg").write_text("x")
    (feat / "lisflood-files" / "dem.ascii").write_text("x")
    (feat / "DEM_Neuse.tif").write_text("x")

    ctx = {"aoi_features": [{"folder_path": str(feat)}]}
    out = Path(REGISTRY["tcfg"].collect(ctx, tmp_path))
    names = {p.name for p in out.iterdir()}
    assert {"dem.asc", "model.cfg", "DEM_Neuse.tif"} <= names
    assert "dem.ascii" not in names         # the LISFLOOD deck stays out


def test_tbc_fills_the_per_type_default_value():
    jt = REGISTRY["tbc"]
    assert jt.transform_config({"bc_type": 2}, ctx=None)["value"] == 0.001
    assert jt.transform_config({"bc_type": 3}, ctx=None)["value"] == 0.5
    # an explicit value is never overridden
    assert jt.transform_config({"bc_type": 2, "value": 0.01},
                               ctx=None)["value"] == 0.01


def test_thyg_inherits_the_flow_data_validation():
    problems = REGISTRY["thyg"].validate_config(
        {"start_dt": "2024-06-01T00:00", "end_dt": "2024-06-10T00:00"})
    assert any("1979-02-01 to 2023-01-31" in p for p in problems)


def test_triton_steps_point_at_the_triton_orchestrators():
    for key in ("tfric", "tbc", "thyg", "tcfg"):
        jt = REGISTRY[key]
        assert jt.orchestrator_module == "fimcore.triton_orchestrate", key
        assert jt.orchestrator.startswith("run_triton_"), key
