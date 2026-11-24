"""A2F-2: picking a Flowline-tool network for the A2F Flowline step.

Only the "all flowlines" output carries stream IDs; a shapefile travels with
its side files; the copy is re-checked before it is stored.
"""
import geopandas as gpd
import pytest
from shapely.geometry import LineString, Point, Polygon, box

from tethysapp.fimsim_gui.job_types import REGISTRY
from tethysapp.fimsim_gui.prepared import classify, copy_prepared, prepared_rows
from tethysapp.fimsim_gui.storage import make_local_service
from tethysapp.fimsim_gui.tests.test_prepared import _err, _run

AOI = box(-96.8, 43.5, -96.6, 43.7)            # the modeling area (EPSG:4326)
TOOL_AREA = box(-97.0, 43.0, -96.0, 44.0)      # the Flowline tool run's area
SRC = "admin/9/1/flowline_tool/all_flowlines_T2_04"
DEST = "admin/3/7/user_flowline/all_flowlines_T2_04"


def _network(**cols):
    return gpd.GeoDataFrame(
        {"COMID": [11, 12], "Hydroseq": [2, 1], "DnHydroseq": [1, 0], **cols},
        geometry=[LineString([(-96.75, 43.55), (-96.70, 43.60)]),
                  LineString([(-96.70, 43.60), (-96.65, 43.65)])],
        crs="EPSG:4326")


def _store(storage, tmp_path, gdf, ext="shp", drop=()):
    """Write *gdf* as a tool output and save every file of it under SRC."""
    local = tmp_path / "tool"
    local.mkdir(exist_ok=True)
    gdf.to_file(local / f"all_flowlines_T2_04.{ext}")
    for f in local.iterdir():
        if f.suffix not in drop:
            with open(f, "rb") as fh:
                storage.save(f"admin/9/1/flowline_tool/{f.name}", fh)


# ── which tool outputs are pickable ──────────────────────────────────────────

@pytest.mark.parametrize("name, usable", [
    ("all_flowlines_T2_04.shp", True),
    ("all_flowlines_T2_04.gpkg", True),
    ("all_flowlines_T2_04.csv", False),
    ("all_flowlines_T2_04.tif", False),
    ("main_river_T2_04.shp", False),
])
def test_only_the_all_flowlines_vector_is_usable(name, usable):
    assert classify(name, "flowline")[0] is usable


def test_main_river_says_how_to_get_a_usable_network():
    _usable, reason = classify("main_river_T2_04.shp", "flowline")
    assert "Save all flowlines" in reason


def test_side_files_and_other_outputs_are_not_listed():
    for name in ("all_flowlines_T2_04.dbf", "feature_ids_T2_04.csv",
                 "usgs_gages_T2_04.csv", "preview_features.geojson"):
        assert classify(name, "flowline") is None


def test_rows_judge_coverage_by_the_tool_area_not_the_lines():
    run = _run(5, "flowline_tool", ["all_flowlines_T2_04.shp", "all_flowlines_T2_04.dbf"])

    [row] = prepared_rows([run], "flowline", AOI, bounds_fn=None,
                          tool_area_fn=lambda r: TOOL_AREA)

    assert row["usable"] and row["covers"] is True
    assert row["detail"] == "NHD flowlines"


# an L-shaped tool area whose bounding box contains AOI but whose polygon
# leaves AOI's north-east corner out — the network has no streams there
L_SHAPE = Polygon([(-97.0, 43.0), (-96.0, 43.0), (-96.0, 43.6), (-96.7, 43.6),
                   (-96.7, 44.0), (-97.0, 44.0)])


def test_rows_use_the_tool_area_polygon_not_its_bounding_box():
    run = _run(5, "flowline_tool", ["all_flowlines_T2_04.shp"])

    [row] = prepared_rows([run], "flowline", AOI, bounds_fn=None,
                          tool_area_fn=lambda r: L_SHAPE)

    assert row["usable"] and row["covers"] is False


# ── copying a pick ───────────────────────────────────────────────────────────

def test_a_shapefile_is_copied_with_its_side_files(tmp_path):
    st = make_local_service(tmp_path / "store")
    _store(st, tmp_path, _network())

    out = copy_prepared(st, SRC + ".shp", DEST + ".shp", "flowline", AOI, TOOL_AREA)

    assert out["key"] == DEST + ".shp" and out["name"] == "all_flowlines_T2_04.shp"
    for ext in (".shp", ".shx", ".dbf", ".prj", ".cpg"):
        assert st.exists(DEST + ext)
    assert out["bytes"] > st.size(DEST + ".shp")       # counts the side files


def test_a_shapefile_missing_its_dbf_is_refused(tmp_path):
    st = make_local_service(tmp_path / "store")
    _store(st, tmp_path, _network(), drop=(".dbf",))

    status, msg = _err(copy_prepared, st, SRC + ".shp", DEST + ".shp", "flowline", AOI, TOOL_AREA)

    assert status == 400 and ".dbf file is missing" in msg
    assert not st.exists(DEST + ".shp")


def test_a_geopackage_is_one_file(tmp_path):
    st = make_local_service(tmp_path / "store")
    _store(st, tmp_path, _network(), ext="gpkg")

    out = copy_prepared(st, SRC + ".gpkg", DEST + ".gpkg", "flowline", AOI, TOOL_AREA)

    assert st.exists(out["key"])


@pytest.mark.parametrize("gdf, reason", [
    (_network().drop(columns="COMID"), "stream-ID column"),
    (gpd.GeoDataFrame({"COMID": [1]}, geometry=[Point(-96.7, 43.6)], crs="EPSG:4326"),
     "no stream lines"),
    (_network().set_geometry(_network().translate(5, 0)), "reach this area"),
])
def test_unusable_networks_are_refused_with_the_reason(tmp_path, gdf, reason):
    st = make_local_service(tmp_path / "store")
    _store(st, tmp_path, gdf, ext="gpkg")

    status, msg = _err(copy_prepared, st, SRC + ".gpkg", DEST + ".gpkg", "flowline", AOI, TOOL_AREA)

    assert status == 400 and reason in msg
    assert not st.exists(DEST + ".gpkg")


def test_a_pick_from_a_tool_area_that_misses_part_of_this_one_is_refused(tmp_path):
    st = make_local_service(tmp_path / "store")
    _store(st, tmp_path, _network(), ext="gpkg")

    status, msg = _err(copy_prepared, st, SRC + ".gpkg", DEST + ".gpkg", "flowline",
                       AOI, L_SHAPE)

    assert status == 400 and "does not cover this area" in msg


def test_a_failed_save_leaves_no_half_stored_shapefile(tmp_path):
    st = make_local_service(tmp_path / "store")
    _store(st, tmp_path, _network())
    real_save = st.save

    def flaky_save(key, content):
        if key.endswith(".dbf"):
            raise OSError("storage hiccup")
        return real_save(key, content)
    st.save = flaky_save

    status, _msg = _err(copy_prepared, st, SRC + ".shp", DEST + ".shp", "flowline",
                        AOI, TOOL_AREA)

    assert status == 503
    for ext in (".shp", ".shx", ".dbf", ".prj", ".cpg"):
        assert not st.exists(DEST + ext)


def test_a_new_pick_removes_the_previous_picks_extra_parts(tmp_path):
    st = make_local_service(tmp_path / "store")
    st.save(DEST + ".cpg", b"LATIN1")                 # left by an earlier pick
    _store(st, tmp_path, _network(), drop=(".cpg",))

    copy_prepared(st, SRC + ".shp", DEST + ".shp", "flowline", AOI, TOOL_AREA)

    assert st.exists(DEST + ".dbf") and not st.exists(DEST + ".cpg")


# ── the A2F Flowline step with a pick ────────────────────────────────────────

def test_flowline_step_stages_the_pick_with_its_side_files(tmp_path):
    st = make_local_service(tmp_path / "store")
    _store(st, tmp_path, _network())
    copy_prepared(st, SRC + ".shp", DEST + ".shp", "flowline", AOI, TOOL_AREA)
    folder = tmp_path / "AOI_1"
    folder.mkdir()
    ctx = {"aoi_features": [{"folder_path": str(folder)}]}
    config = {"source": "prepared", "user_flowline_keys": [DEST + ".shp"]}

    REGISTRY["aflow"].prestage_inputs(st, ctx, config, lambda *a: None)

    staged = folder / "user_flowline" / "all_flowlines_T2_04.shp"
    assert config["user_path"] == str(staged)
    assert len(gpd.read_file(staged)) == 2          # side files came along
    fimcore_cfg = REGISTRY["aflow"].transform_config(REGISTRY["aflow"].merged(config), ctx)
    assert fimcore_cfg == {"source": "user", "user_path": str(staged)}


def test_flowline_step_without_a_pick_fails_with_a_reason(tmp_path):
    ctx = {"aoi_features": [{"folder_path": str(tmp_path)}]}
    with pytest.raises(ValueError, match="pick one prepared flowline"):
        REGISTRY["aflow"].prestage_inputs(None, ctx, {"source": "prepared"},
                                          lambda *a: None)


def test_a_client_cannot_name_the_worker_path():
    assert "user_path" in REGISTRY["aflow"].server_only_keys
    assert REGISTRY["aflow"].validate_config(
        {"source": "prepared", "user_flowline_keys": ["k"]}) == []
