"""FIMSIM-BE22 / BE23: Roughness and Flow Data use a file picked from a
Preparing Input Data tool (copied into the AOI by BE21, named in the config as
user_<kind>_keys). Staging turns the pick into fimcore's own arguments."""
from pathlib import Path

import pytest

from tethysapp.fimsim_gui.job_types import REGISTRY


CSV = ("time_hours,discharge_cms\n"
       "2016-10-08 00:00:00+00:00,10.0\n"
       "2016-10-08 01:00:00+00:00,25.5\n"
       "2016-10-08 02:00:00+00:00,18.0\n")


class FakeStorage:
    """Writes the 'downloaded' object locally; flow keys get a dated CSV."""

    def __init__(self, body=CSV):
        self.body = body
        self.keys = []

    def download_to_path(self, key, dest):
        self.keys.append(key)
        Path(dest).parent.mkdir(parents=True, exist_ok=True)
        Path(dest).write_text(self.body if key.endswith(".csv") else "raster")


def _ctx(tmp_path):
    feat = tmp_path / "aoi"
    feat.mkdir(parents=True)
    return {"aoi_features": [{"folder_path": str(feat)}]}


def _noop(*_a):
    return None


# ── Roughness (manning = LISFLOOD-FP, tfric = TRITON) ─────────────────────────

@pytest.mark.parametrize("step", ["manning", "tfric"])
@pytest.mark.parametrize("choice", ["download", "prepared_manning", "prepared_lulc"])
def test_roughness_accepts_each_input_choice(step, choice):
    cfg = {"manning_input": choice, "user_manning_keys": ["k"], "user_lulc_keys": ["k"]}
    assert REGISTRY[step].validate_config(cfg) == []


@pytest.mark.parametrize("step", ["manning", "tfric"])
def test_roughness_rejects_unknown_choice_and_raw_paths(step):
    problems = REGISTRY[step].validate_config({"manning_input": "upload"})
    assert any("manning_input" in p for p in problems)
    # the staged worker paths are server-only: stripped before validation
    for key in REGISTRY[step].server_only_keys:
        assert key.endswith("_path") or key.startswith("have_")


def test_lisflood_manning_grid_pick_feeds_prepare_manning(tmp_path):
    jt, ctx = REGISTRY["manning"], _ctx(tmp_path)
    cfg = jt.merged({"manning_input": "prepared_manning", "fric_mode": "fixed",
                     "user_manning_keys": ["u/1/2/user_manning/ManningN_A.tif"]})
    jt.prestage_inputs(FakeStorage(), ctx, cfg, _noop)
    kw = jt.transform_config(cfg, ctx)
    assert kw["have_manning_raster"] is True
    assert Path(kw["manning_src_path"]).is_file()
    assert kw["fric_mode"] == "varying"           # a file means varying friction
    for ui_key in ("manning_input", "user_manning_keys", "user_lulc_keys"):
        assert ui_key not in kw                   # prepare_manning is keyword-only


def test_lisflood_land_cover_pick_keeps_the_class_table(tmp_path):
    jt, ctx = REGISTRY["manning"], _ctx(tmp_path)
    table = {"11": 0.035}
    cfg = jt.merged({"manning_input": "prepared_lulc", "manning_mapping": table,
                     "user_lulc_keys": ["u/1/2/user_lulc/LULC_A.tif"]})
    jt.prestage_inputs(FakeStorage(), ctx, cfg, _noop)
    kw = jt.transform_config(cfg, ctx)
    assert kw["have_lulc"] is True and Path(kw["lulc_src_path"]).is_file()
    assert kw["manning_mapping"] == table
    assert "have_manning_raster" not in kw


def test_triton_picks_map_to_the_builder_sources(tmp_path):
    jt = REGISTRY["tfric"]
    for choice, kind, source in (("prepared_manning", "manning", "user_manning"),
                                 ("prepared_lulc", "lulc", "user_lulc")):
        ctx = _ctx(tmp_path / choice)
        cfg = jt.merged({"manning_input": choice, "lulc_source": "download_nlcd",
                         "manning_mapping": {"11": 0.035},
                         f"user_{kind}_keys": [f"u/1/2/user_{kind}/f.tif"]})
        jt.prestage_inputs(FakeStorage(), ctx, cfg, _noop)
        kw = jt.transform_config(cfg, ctx)
        assert kw["lulc_source"] == source
        assert Path(kw[f"user_{kind}_path"]).is_file()
        assert kw["lulc_class_to_n"] == {"11": 0.035}
        assert "manning_input" not in kw and "manning_mapping" not in kw
        # the preview still colours by the land cover's own classes
        assert ctx["_preview_lulc_source"] == "download_nlcd"


@pytest.mark.parametrize("step", ["manning", "tfric"])
def test_roughness_download_stages_nothing(step, tmp_path):
    storage, cfg = FakeStorage(), REGISTRY[step].merged({})
    REGISTRY[step].prestage_inputs(storage, _ctx(tmp_path), cfg, _noop)
    assert storage.keys == []
    assert not any(k.endswith("_path") for k in cfg)


@pytest.mark.parametrize("step", ["manning", "tfric"])
def test_roughness_pick_without_a_file_fails_with_a_reason(step, tmp_path):
    cfg = REGISTRY[step].merged({"manning_input": "prepared_lulc"})
    with pytest.raises(ValueError, match="pick one prepared land cover"):
        REGISTRY[step].prestage_inputs(FakeStorage(), _ctx(tmp_path), cfg, _noop)


# ── Flow Data (bdy = LISFLOOD-FP, thyg = TRITON) ──────────────────────────────

@pytest.mark.parametrize("step", ["bdy", "thyg"])
def test_flow_pick_needs_no_event_window(step):
    assert REGISTRY[step].validate_config(
        {"bdy_source": "prepared", "user_flow_keys": ["k"]}) == []
    # the download sources still require one
    assert REGISTRY[step].validate_config({"bdy_source": "nwm_retro"}) != []


@pytest.mark.parametrize("step", ["bdy", "thyg"])
def test_flow_pick_becomes_a_dated_csv_source(step, tmp_path):
    jt, ctx = REGISTRY[step], _ctx(tmp_path)
    cfg = jt.merged({"bdy_source": "prepared",
                     "user_flow_keys": ["u/1/2/user_flow/nwm_retro_123.csv"]})
    jt.prestage_inputs(FakeStorage(), ctx, cfg, _noop)
    assert cfg["start_dt"] == "2016-10-08T00:00:00"
    assert cfg["end_dt"] == "2016-10-08T02:00:00"
    assert "start_dt" in jt.derived_config_keys      # saved for the UI
    kw = jt.transform_config(cfg, ctx)
    assert kw["bdy_source"] == "csv"
    assert Path(kw["file_path"]).is_file()
    assert kw["start_dt"].year == 2016 and "user_flow_keys" not in kw
    assert "file_path" in jt.server_only_keys


def test_flow_pick_without_dates_is_refused(tmp_path):
    jt = REGISTRY["bdy"]
    cfg = jt.merged({"bdy_source": "prepared", "user_flow_keys": ["u/1/2/user_flow/q.csv"]})
    storage = FakeStorage(body="time_hours,discharge_cms\n0,1.0\n1,2.0\n")
    with pytest.raises(ValueError, match="no dates"):
        jt.prestage_inputs(storage, _ctx(tmp_path), cfg, _noop)


def test_flow_download_sources_stage_nothing(tmp_path):
    storage = FakeStorage()
    cfg = REGISTRY["bdy"].merged({"start_dt": "2016-10-08", "end_dt": "2016-10-09"})
    REGISTRY["bdy"].prestage_inputs(storage, _ctx(tmp_path), cfg, _noop)
    assert storage.keys == [] and "file_path" not in cfg
