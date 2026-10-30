"""FIMSIM-BE25: the Preparing Input Data tools as job types — validation per
tool, the option → fimcore-kwarg mapping, and collect/preview behaviour.
fimcore is only ever called through a monkeypatched stand-in here."""
import json
from pathlib import Path

import pytest

from tethysapp.fimsim_gui.job_types import REGISTRY

TOOLS = ("dem_tool", "lulc_tool", "flowline_tool", "flow_tool")


def _problems(step, config):
    return REGISTRY[step].validate_config(config)


def _square_aoi_geojson(tmp_path: Path) -> Path:
    # Lumber River neighbourhood (Test Case 3), a rectangle
    ring = [[-79.05, 34.60], [-78.95, 34.60], [-78.95, 34.70],
            [-79.05, 34.70], [-79.05, 34.60]]
    fc = {"type": "FeatureCollection",
          "features": [{"type": "Feature", "properties": {"name": "Lumber"},
                        "geometry": {"type": "Polygon", "coordinates": [ring]}}]}
    p = tmp_path / "aoi.geojson"
    p.write_text(json.dumps(fc))
    return p


# ── shared contract ──────────────────────────────────────────────────────────

def test_tools_are_registered_with_no_prerequisites():
    for key in TOOLS:
        jt = REGISTRY[key]
        assert jt.step_key == key
        assert jt.requires == ()
        assert jt.server_only_keys == ()


def test_collect_ships_every_top_level_file_but_engine_scratch(tmp_path):
    feat = tmp_path / "Lumber"
    feat.mkdir()
    for name in ("main_river_Lumber.shp", "main_river_Lumber.dbf", "main_river_Lumber.prj",
                 "usgs_gages_Lumber.csv", "workflow_context.json", "_snap.tif",
                 "LULC_Lumber.tif.aux.xml"):
        (feat / name).write_text("x")
    (feat / "DEM_raw_aoi_f0").mkdir()
    (feat / "DEM_raw_aoi_f0" / "USGS_13_n35w079.tif").write_text("x")   # tile cache

    ctx = {"aoi_features": [{"folder_path": str(feat)}]}
    out = Path(REGISTRY["flowline_tool"].collect(ctx, tmp_path))
    names = {p.name for p in out.iterdir()}
    assert names == {"main_river_Lumber.shp", "main_river_Lumber.dbf",
                     "main_river_Lumber.prj", "usgs_gages_Lumber.csv"}


def test_feature_round_trips_through_the_ctx(tmp_path):
    _, ctx = REGISTRY["dem_tool"].prepare(
        tmp_path, _square_aoi_geojson(tmp_path), lambda *_: None)
    feat = REGISTRY["dem_tool"].feature(ctx)
    assert feat.feature_index == 0
    assert feat.folder_path == ctx["aoi_features"][0]["folder_path"]
    assert feat.working_crs_epsg                      # inspect_features filled it


# ── DEM tool ─────────────────────────────────────────────────────────────────

def test_dem_tool_validation():
    assert _problems("dem_tool", {"dem_source": "hand", "dem_res_m": 10,
                                  "out_format": "asc"}) == []
    assert any("dem_source" in p for p in _problems("dem_tool", {"dem_source": "srtm"}))
    assert any("dem_res_m" in p for p in _problems("dem_tool", {"dem_res_m": 5}))   # web floor 10 m
    assert any("out_format" in p for p in _problems("dem_tool", {"out_format": "png"}))
    assert any("unknown option 'user_dem_keys'" in p
               for p in _problems("dem_tool", {"user_dem_keys": ["k"]}))   # no upload path


def test_dem_tool_calls_run_dem_mode_with_the_desktop_kwargs(tmp_path, monkeypatch):
    import fimcore.orchestrate as orch
    calls = []
    monkeypatch.setattr(orch, "run_dem_mode",
                        lambda project_dir, features, **kw: calls.append(
                            (project_dir, features, kw)))
    jt = REGISTRY["dem_tool"]
    ctx_path, ctx = jt.prepare(tmp_path, _square_aoi_geojson(tmp_path), lambda *_: None)
    jt.execute(ctx_path, ctx, {"dem_source": "hand", "dem_res_m": 30, "out_format": "gpkg"},
               lambda *_: None)
    (project_dir, features, kw), = calls
    assert project_dir == ctx["project_dir"]
    assert len(features) == 1 and features[0].feature_index == 0
    assert kw["dem_cell_size_m"] == 30.0 and kw["out_format"] == "gpkg"
    assert kw["dem_source"] == "hand"


def test_dem_tool_tile_cache_dir_is_where_run_dem_mode_downloads():
    # fimcore.dem keys the full-tile folder off ctx["project_dir"]/DEM_raw_<aoi_name>;
    # run_dem_mode's per-feature ctx sets project_dir = the AOI folder and
    # aoi_name = "<aoi stem>_f<index>" (orchestrate._make_feature_ctx)
    ctx = {"aoi_features": [{"folder_path": "/scratch/job/Lumber",
                             "source_file": "/scratch/aoi.geojson", "feature_index": 0}]}
    assert REGISTRY["dem_tool"]._tiles_dir(ctx) == Path("/scratch/job/Lumber/DEM_raw_aoi_f0")


# ── LULC & Manning tool ──────────────────────────────────────────────────────

def test_lulc_tool_validation():
    ok = {"lulc_source": "sentinel2", "sentinel2_year": 2023, "cell_size_m": 10,
          "lulc_format": "gpkg", "do_manning": True, "manning_format": "shp",
          "manning_mapping": {"1": 0.03, "2": 0.12}}
    assert _problems("lulc_tool", ok) == []
    assert any("'sentinel2_year'" in p
               for p in _problems("lulc_tool", {"sentinel2_year": 2016}))
    assert any("'nlcd_year'" in p for p in _problems("lulc_tool", {"nlcd_year": "2020"}))
    assert any("do_manning" in p for p in _problems("lulc_tool", {"do_manning": "yes"}))
    assert any("manning_format" in p for p in _problems("lulc_tool", {"manning_format": "png"}))
    assert any("lulc_format" in p for p in _problems("lulc_tool", {"lulc_format": "shp"}))
    assert any("cell_size_m" in p for p in _problems("lulc_tool", {"cell_size_m": 1}))
    assert any("manning_mapping" in p
               # above the hard band
               for p in _problems("lulc_tool", {"manning_mapping": {"1": 0.5}}))


def test_lulc_tool_passes_the_desktop_dict_and_stashes_the_preview_source(tmp_path, monkeypatch):
    import fimcore.orchestrate as orch
    calls = []
    monkeypatch.setattr(orch, "run_lulc_mode",
                        lambda project_dir, features, **kw: calls.append(
                            (project_dir, features, kw)))
    jt = REGISTRY["lulc_tool"]
    ctx_path, ctx = jt.prepare(tmp_path, _square_aoi_geojson(tmp_path), lambda *_: None)
    jt.execute(ctx_path, ctx, {"lulc_source": "sentinel2", "manning_mapping": {"2": 0.1}},
               lambda *_: None)
    (_, features, kw), = calls
    cfg, = kw["per_aoi_configs"]
    assert cfg["lulc_source"] == "sentinel2" and cfg["do_manning"] is True   # default kept
    assert cfg["manning_mapping"]["2"] == 0.1
    assert cfg["cell_size_m"] == 30 and cfg["lulc_format"] == "tif"
    assert ctx["_preview_lulc_source"] == "sentinel2"
    assert ctx["_preview_manning_mapping"] == cfg["manning_mapping"]


def _lulc_mapping_sent_to_fimcore(tmp_path, monkeypatch, config):
    import fimcore.orchestrate as orch
    calls = []
    monkeypatch.setattr(orch, "run_lulc_mode",
                        lambda project_dir, features, **kw: calls.append(kw))
    jt = REGISTRY["lulc_tool"]
    ctx_path, ctx = jt.prepare(tmp_path, _square_aoi_geojson(tmp_path), lambda *_: None)
    jt.execute(ctx_path, ctx, config, lambda *_: None)
    (kw,) = calls
    (cfg,) = kw["per_aoi_configs"]
    return cfg["manning_mapping"], ctx


def test_lulc_tool_sends_every_class_default_when_the_table_was_not_edited(
        tmp_path, monkeypatch):
    # C2: fimcore stamps only the listed classes over a flat 0.045 — the tool
    # must send the full table, not nothing
    from fimcore.nlcd import NLCD_MANNING
    mapping, ctx = _lulc_mapping_sent_to_fimcore(tmp_path, monkeypatch, {})
    expected = {str(code): vals[3] for code, vals in NLCD_MANNING.items()}
    expected["default"] = 0.045
    assert mapping == expected
    assert ctx["_preview_manning_mapping"] == mapping


def test_lulc_tool_overlays_a_partial_edit_on_the_class_defaults(tmp_path, monkeypatch):
    from fimcore.nlcd import NLCD_MANNING
    submitted = {"default": 0.045, "41": 0.12}
    mapping, ctx = _lulc_mapping_sent_to_fimcore(
        tmp_path, monkeypatch, {"manning_mapping": submitted})
    assert mapping["41"] == 0.12
    for code, (_name, _lo, _hi, dflt) in NLCD_MANNING.items():
        if code != 41:
            assert mapping[str(code)] == dflt
    assert mapping["default"] == 0.045
    assert ctx["_preview_manning_mapping"] == mapping
    assert submitted == {"default": 0.045, "41": 0.12}     # caller's dict untouched


def test_lulc_tool_sentinel2_defaults_skip_classes_without_a_value(tmp_path, monkeypatch):
    from fimcore.nlcd import SENTINEL2_MANNING
    mapping, _ = _lulc_mapping_sent_to_fimcore(
        tmp_path, monkeypatch, {"lulc_source": "sentinel2"})
    assert "10" not in mapping                                # Clouds: no n
    assert mapping["2"] == SENTINEL2_MANNING[2][3]
    assert set(mapping) == {str(c) for c, v in SENTINEL2_MANNING.items()
                            if v[3] is not None} | {"default"}


def test_lulc_tool_transform_returns_a_copy():
    jt = REGISTRY["lulc_tool"]
    cfg = jt.merged({"manning_mapping": {"41": 0.12}})
    before = json.loads(json.dumps(cfg))
    out = jt.transform_config(cfg, {})
    assert out is not cfg and cfg == before


# ── Flowline tool ────────────────────────────────────────────────────────────

def test_flowline_tool_validation():
    assert _problems("flowline_tool", {"save_main_river": True, "main_format": "tif",
                                       "cell_size_m": 10}) == []
    assert any("main_format" in p for p in _problems("flowline_tool", {"main_format": "kml"}))
    assert any("all_format" in p for p in _problems("flowline_tool", {"all_format": "png"}))
    assert any("save_gages_csv" in p
               for p in _problems("flowline_tool", {"save_gages_csv": "yes"}))
    assert any("cell_size_m" in p for p in _problems("flowline_tool", {"cell_size_m": 5}))


def test_flowline_tool_requires_one_output():
    # Review Focus 2: every box unticked is a clear rejection, not a lookup
    # that saves nothing
    nothing = {"save_main_river": False, "save_all_flowlines": False,
               "save_gages_csv": False, "save_feature_ids": False}
    problems = _problems("flowline_tool", nothing)
    assert len(problems) == 1 and "at least one output" in problems[0]
    assert _problems("flowline_tool", {**nothing, "save_feature_ids": True}) == []


def test_flowline_tool_runs_fimcore_and_writes_the_map_preview(tmp_path, monkeypatch):
    gpd = pytest.importorskip("geopandas")
    from shapely.geometry import LineString
    import fimcore.flowline_mode as fm
    import fimcore.aoi_info as ai

    river = gpd.GeoDataFrame(geometry=[LineString([(-79.0, 34.62), (-78.97, 34.68)])],
                             crs="EPSG:4326")
    calls = []

    def fake_run(project_dir, features, per_aoi_configs=None, log_fn=print):
        calls.append(per_aoi_configs)
        folder = Path(features[0].folder_path)
        (folder / "main_river_Lumber.shp").write_text("x")
        return {"features": [{"files": {"main_river": str(folder / "main_river_Lumber.shp")},
                              "_main_river_gdf": river, "_all_flowlines_gdf": river}]}

    monkeypatch.setattr(fm, "run_flowline_mode", fake_run)
    monkeypatch.setattr(ai, "lookup_usgs_gages",
                        lambda *a, **k: [{"site_no": "02134170", "station_nm": "LUMBER",
                                          "lat": 34.65, "lon": -78.98}])
    jt = REGISTRY["flowline_tool"]
    ctx_path, ctx = jt.prepare(tmp_path, _square_aoi_geojson(tmp_path), lambda *_: None)
    jt.execute(ctx_path, ctx, {"save_all_flowlines": False}, lambda *_: None)

    cfg, = calls[0]
    assert cfg["save_main_river"] is True and cfg["main_format"] == "shp"
    assert cfg["save_all_flowlines"] is False and cfg["cell_size_m"] == 30
    folder = Path(ctx["aoi_features"][0]["folder_path"])
    fc = json.loads((folder / "preview_features.geojson").read_text())
    kinds = sorted(f["properties"]["kind"] for f in fc["features"])
    assert kinds == ["gage", "main_river"]          # unsaved network is not drawn
    out = Path(jt.collect(ctx, tmp_path))
    assert {"main_river_Lumber.shp", "preview_features.geojson"} <= {p.name for p in out.iterdir()}


def test_flowline_tool_fails_when_nothing_could_be_saved(tmp_path, monkeypatch):
    import fimcore.flowline_mode as fm
    monkeypatch.setattr(fm, "run_flowline_mode",
                        lambda *a, **k: {"features": [{"files": {}, "_main_river_gdf": None,
                                                       "_all_flowlines_gdf": None}]})
    jt = REGISTRY["flowline_tool"]
    ctx_path, ctx = jt.prepare(tmp_path, _square_aoi_geojson(tmp_path), lambda *_: None)
    with pytest.raises(RuntimeError, match="no NHD reach"):
        jt.execute(ctx_path, ctx, {"save_gages_csv": False, "save_feature_ids": False},
                   lambda *_: None)


# ── Streamflow tool ──────────────────────────────────────────────────────────

def test_split_ids_accepts_mixed_separators_and_lists():
    from tethysapp.fimsim_gui.job_types.steps_tools import split_ids
    assert split_ids("02134170, 02134500 ") == ["02134170", "02134500"]
    assert split_ids("8781135;8781137\n8781139") == ["8781135", "8781137", "8781139"]
    assert split_ids([8781135, " 02134170 "]) == ["8781135", "02134170"]
    assert split_ids("") == [] and split_ids(None) == []


def test_flow_tool_validation_retro_and_usgs():
    retro = {"source": "nwm_retro", "ids": "8781135, 8781137",
             "start_dt": "2016-10-01T00:00", "end_dt": "2016-10-19T23:59", "interval_hours": 3}
    assert _problems("flow_tool", retro) == []
    assert any("1979-02-01 to 2023-01-31" in p
               for p in _problems("flow_tool", {**retro, "start_dt": "2024-01-01T00:00",
                                                "end_dt": "2024-01-05T00:00"}))
    usgs = {"source": "usgs", "ids": "02134170",
            "start_dt": "2016-10-01T00:00", "end_dt": "2016-10-19T23:59", "interval_hours": 0.25}
    assert _problems("flow_tool", usgs) == []
    assert any("8–15 digits" in p for p in _problems("flow_tool", {**usgs, "ids": "2134170"}))
    assert any("'ids' is required" in p for p in _problems("flow_tool", {"source": "usgs"}))
    assert any("interval_hours" in p for p in _problems("flow_tool", {**usgs, "interval_hours": 2}))


def test_flow_tool_rejects_sub_hourly_intervals_for_the_hourly_retrospective():
    # M2: NWM retrospective is hourly; 15/30 min apply to USGS gages only
    retro = {"source": "nwm_retro", "ids": "8781135",
             "start_dt": "2016-10-01T00:00", "end_dt": "2016-10-19T23:59"}
    for sub in (0.25, 0.5):
        assert any("hourly" in p
                   for p in _problems("flow_tool", {**retro, "interval_hours": sub}))
    assert _problems("flow_tool", {**retro, "interval_hours": 1}) == []


def test_flow_tool_rejects_non_numeric_ids():
    # Review Focus 4: the offending token is named
    problems = _problems("flow_tool", {"source": "nwm_retro", "ids": "8781135, abc",
                                       "start_dt": "2016-10-01T00:00",
                                       "end_dt": "2016-10-02T00:00"})
    assert len(problems) == 1 and "abc" in problems[0]


def test_flow_tool_validation_forecast():
    fc = {"source": "nwm_forecast", "ids": "8781135", "forecast_range": "short_range",
          "forecast_date": "2024-09-27", "forecast_hour": 6}
    assert _problems("flow_tool", fc) == []
    assert _problems("flow_tool", {**fc, "forecast_hour": None}) == []      # Auto cycle
    assert any("forecast_hour" in p for p in _problems("flow_tool", {**fc, "forecast_hour": 7}))
    assert any("forecast_range" in p
               for p in _problems("flow_tool", {**fc, "forecast_range": "weekly"}))
    assert any("'forecast_date' is required" in p
               for p in _problems("flow_tool", {"source": "nwm_forecast", "ids": "1"}))
    assert any("2018-09-17" in p
               for p in _problems("flow_tool", {**fc, "forecast_date": "2017-01-01"}))
    # a forecast never needs the event window
    assert not any("start_dt" in p for p in _problems("flow_tool", fc))


def test_flow_tool_transform_builds_the_desktop_config():
    from datetime import datetime
    jt = REGISTRY["flow_tool"]
    retro = jt.transform_config(jt.merged({"source": "usgs", "ids": "02134170 02134500",
                                           "start_dt": "2016-10-01T00:00",
                                           "end_dt": "2016-10-19T23:59"}), None)
    assert retro == {"source": "usgs", "ids": "02134170, 02134500",
                     "start_dt": datetime(2016, 10, 1), "end_dt": datetime(2016, 10, 19, 23, 59),
                     "interval_hours": 1.0}
    fc = jt.transform_config(jt.merged({"source": "nwm_forecast", "ids": "8781135",
                                        "forecast_date": "2024-09-27", "forecast_hour": 12}), None)
    assert fc["forecast_range"] == "medium_range" and fc["forecast_date"] == "2024-09-27"
    assert fc["forecast_hour"] == 12 and fc["interval_hours"] == 1.0
    assert fc["start_dt"] == datetime(2024, 9, 27)
    assert fc["end_dt"] == datetime(2024, 10, 7)            # desktop: issue day + 10 days


def test_flow_tool_runs_in_the_aoi_folder(tmp_path, monkeypatch):
    import fimcore.run_streamflow as rs
    calls = []

    def fake_run(project_dir, configs, log_fn=print):
        calls.append((project_dir, configs))
        p = Path(project_dir) / "usgs_discharge_02134170.csv"
        p.write_text("time_hours,discharge_cms\n2016-10-11 00:00:00,410.0\n")
        return {"results": [{"source": "usgs", "id": "02134170", "csv_path": str(p)}],
                "warnings": ["USGS gage 02134170: No data available after 2016-10-18"]}

    monkeypatch.setattr(rs, "run_streamflow_mode", fake_run)
    logged = []
    jt = REGISTRY["flow_tool"]
    ctx_path, ctx = jt.prepare(tmp_path, _square_aoi_geojson(tmp_path), lambda *_: None)
    jt.execute(ctx_path, ctx, {"source": "usgs", "ids": "02134170",
                               "start_dt": "2016-10-01T00:00", "end_dt": "2016-10-19T23:59"},
               logged.append)
    (project_dir, configs), = calls
    assert project_dir == ctx["aoi_features"][0]["folder_path"]   # CSVs land beside the AOI
    assert configs[0]["ids"] == "02134170"
    assert any("No data available after" in line for line in logged)   # coverage warnings surface
    out = Path(jt.collect(ctx, tmp_path))
    assert {p.name for p in out.iterdir()} == {"usgs_discharge_02134170.csv"}


def test_flow_tool_fails_when_no_series_came_back(tmp_path, monkeypatch):
    # Review Focus 1: fimcore logs-and-continues on an unknown ID; the job
    # must fail with the IDs and source in the reason
    import fimcore.run_streamflow as rs
    monkeypatch.setattr(rs, "run_streamflow_mode",
                        lambda *a, **k: {"results": [{"source": "usgs", "id": "09999999",
                                                      "csv_path": None,
                                                      "status": "unavailable"}],
                                         "warnings": []})
    jt = REGISTRY["flow_tool"]
    ctx_path, ctx = jt.prepare(tmp_path, _square_aoi_geojson(tmp_path), lambda *_: None)
    with pytest.raises(RuntimeError, match=r"09999999.*usgs"):
        jt.execute(ctx_path, ctx, {"source": "usgs", "ids": "09999999",
                                   "start_dt": "2016-10-01T00:00", "end_dt": "2016-10-19T23:59"},
                   lambda *_: None)
