"""FIMSIM-BE22: Roughness uses a file picked from a
Preparing Input Data tool (copied into the AOI by BE21, named in the config as
user_<kind>_keys). Staging turns the pick into fimcore's own arguments."""
from pathlib import Path

import pytest

from tethysapp.fimsim_gui.job_types import REGISTRY


class FakeStorage:
    """Writes the 'downloaded' object locally."""

    def __init__(self):
        self.keys = []

    def download_to_path(self, key, dest):
        self.keys.append(key)
        Path(dest).parent.mkdir(parents=True, exist_ok=True)
        Path(dest).write_text("raster")


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
