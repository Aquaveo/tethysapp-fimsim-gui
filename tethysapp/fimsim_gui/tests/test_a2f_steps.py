"""A2F (ARC-Curve2Flood) job types — DEM and Flowline (docs/design-a2f.md).

fimcore's ARC orchestrators are never run here: the DEM test spies on the
call, and the Flowline collect test writes the flowline file itself.
"""
import geopandas as gpd
import pytest
from shapely.geometry import LineString

from tethysapp.fimsim_gui.job_types import REGISTRY
from tethysapp.fimsim_gui.jobs import supersede_step_and_downstream
from tethysapp.fimsim_gui.models import (
    A2F_MODEL, STEP_KEYS, TRITON_STEP_KEYS, normalize_model,
)
from tethysapp.fimsim_gui.tests.test_step_submit import _fake_aoi


def _ctx(tmp_path):
    folder = tmp_path / "AOI_1"
    (folder / "arc-files").mkdir(parents=True)
    return {"aoi_features": [{"folder_path": str(folder), "folder_name": "AOI_1",
                              "name": "AOI 1"}]}


# ── model + registry ─────────────────────────────────────────────────────────

def test_a2f_is_a_project_model_with_its_own_step_chain():
    assert normalize_model("ARC-Curve2Flood") == A2F_MODEL
    assert {"adem", "aflow"} <= set(STEP_KEYS)
    assert REGISTRY["adem"].requires == ()
    assert REGISTRY["aflow"].requires == ("adem",)
    # the TRITON backfill must never claim an A2F step
    assert not {"adem", "aflow"} & set(TRITON_STEP_KEYS)


def test_rerunning_a2f_dem_supersedes_its_flowline_but_no_other_model():
    aoi = _fake_aoi([("dem", "succeeded", False), ("tdem", "succeeded", False),
                     ("adem", "succeeded", False), ("aflow", "succeeded", False)])

    supersede_step_and_downstream(aoi, "adem")

    by_key = {r.step_key: r.superseded for r in aoi.step_runs}
    assert by_key == {"dem": False, "tdem": False, "adem": True, "aflow": True}


# ── DEM ──────────────────────────────────────────────────────────────────────

def test_a2f_dem_accepts_uploads_but_never_a_worker_path():
    jt = REGISTRY["adem"]
    assert jt.validate_config({"user_dem_keys": ["k"], "dem_input": "prepared"}) == []
    assert "user_dem_path" in jt.server_only_keys


@pytest.mark.parametrize("res", [1, 90, "10"])
def test_a2f_dem_rejects_resolutions_3dep_13_cannot_give(res):
    assert REGISTRY["adem"].validate_config({"dem_res_m": res})


@pytest.mark.parametrize("staged, has_dem", [(None, False), (["/w/dem.tif"], True)])
def test_a2f_dem_hands_fimcore_one_per_aoi_config(monkeypatch, tmp_path, staged, has_dem):
    import fimcore.arc_orchestrate as arc
    calls = []
    monkeypatch.setattr(arc, "run_arc_dem_all",
                        lambda *a, **kw: calls.append(kw))
    config = {"dem_res_m": 30}
    if staged:
        config["user_dem_path"] = staged      # what prestage_inputs sets

    REGISTRY["adem"].execute("ctx.json", _ctx(tmp_path), config, lambda *a: None)

    [kw] = calls
    assert kw["per_aoi_configs"] == [{"dem_res_m": 30.0, "has_dem": has_dem,
                                      "user_dem_path": staged, "dem_source": "3dep"}]


# ── Flowline ─────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("source", ["user", "prepared ", 3])
def test_a2f_flowline_rejects_unknown_sources(source):
    assert REGISTRY["aflow"].validate_config({"source": source})


def test_a2f_flowline_accepts_nhd_and_geoglows():
    for source in ("nhd", "geoglows"):
        assert REGISTRY["aflow"].validate_config({"source": source}) == []


def test_a2f_flowline_collect_ships_the_shapefile_and_a_preview(tmp_path):
    ctx = _ctx(tmp_path)
    arc_files = tmp_path / "AOI_1" / "arc-files"
    gpd.GeoDataFrame({"COMID": [1, 2]},
                     geometry=[LineString([(-96.8, 43.5), (-96.7, 43.6)]),
                               LineString([(-96.7, 43.6), (-96.6, 43.6)])],
                     crs="EPSG:4326").to_file(arc_files / "flowline.shp")
    (arc_files / "nencarta.json").write_text("{}")   # never a flowline output
    (tmp_path / "work").mkdir()                       # the job wrapper's workdir

    outputs = REGISTRY["aflow"].collect(ctx, tmp_path / "work")

    names = {p.name for p in (tmp_path / "work" / "outputs").iterdir()}
    assert {"flowline.shp", "flowline.shx", "flowline.dbf", "flowline.prj"} <= names
    assert "preview_features.geojson" in names
    assert "nencarta.json" not in names
    assert outputs == str(tmp_path / "work" / "outputs")
