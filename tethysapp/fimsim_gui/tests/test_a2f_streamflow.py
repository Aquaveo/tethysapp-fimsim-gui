"""A2F-3: the A2F Streamflow step and the CIROH NWM key.

The key reaches the worker as an environment variable (never a step config)
and is removed from every context file before the workspace is saved.
fimcore's Streamflow orchestrator is replaced by a stub that writes the key
where the real one does.
"""
import json

import pytest

from tethysapp.fimsim_gui import guards, jobs
from tethysapp.fimsim_gui.job_types import REGISTRY
from tethysapp.fimsim_gui.tests.test_step_submit import _fake_aoi

KEY = "not-a-real-key-123"
OK = {"source": "nwm", "date": "2019-09-19", "hour_utc": 17}


# ── config ───────────────────────────────────────────────────────────────────

def test_test_case_3_settings_are_accepted():
    assert REGISTRY["astream"].validate_config({**OK, "nwm_record": "retrospective"}) == []
    assert REGISTRY["astream"].requires == ("aflow",)


@pytest.mark.parametrize("bad", [
    {"date": None}, {"date": "19-09-2019"}, {"date": "2019-02-30"}, {"source": "usgs"},
    {"hour_utc": 24}, {"hour_utc": 17.5}, {"hour_utc": None},
    {"nwm_record": "medium_range"},
])
def test_bad_streamflow_settings_are_refused(bad):
    assert REGISTRY["astream"].validate_config({**OK, **bad})


def test_nwm_maps_to_a_nencarta_snapshot():
    jt = REGISTRY["astream"]
    assert jt.transform_config(jt.merged(OK), ctx=None) == {
        "streamflow_source": "NWM_short_range", "forensic_forecast_date": "20190919",
        "forensic_forecast_hour": 17, "period_mode": "snapshot", "record": "auto"}


def test_geoglows_has_no_nwm_record():
    jt = REGISTRY["astream"]
    out = jt.transform_config(jt.merged({**OK, "source": "geoglows"}), ctx=None)
    assert out["streamflow_source"] == "GEOGLOWS" and "record" not in out


# ── the key ──────────────────────────────────────────────────────────────────

def test_only_a2f_streamflow_jobs_get_the_key(monkeypatch):
    monkeypatch.setattr(jobs, "nwm_api_key", lambda: KEY)
    assert jobs.job_env_for(REGISTRY["astream"]) == {"FIMSIM_NWM_API_KEY": KEY}
    assert jobs.job_env_for(REGISTRY["arun"]) == {"FIMSIM_NWM_API_KEY": KEY}
    assert jobs.job_env_for(REGISTRY["adem"]) == {}
    assert jobs.job_env_for(REGISTRY["dem"]) == {}


def test_no_key_configured_clears_a_stale_one_on_the_worker(monkeypatch):
    monkeypatch.setattr(jobs, "nwm_api_key", lambda: "")
    env = jobs.job_env_for(REGISTRY["astream"])
    assert env == {"FIMSIM_NWM_API_KEY": ""}
    monkeypatch.setenv("FIMSIM_NWM_API_KEY", "old-key")

    # the worker applies job_env before anything else (run_step_job)
    for name, value in env.items():
        if not value:
            jobs.os.environ.pop(name, None)

    assert "FIMSIM_NWM_API_KEY" not in jobs.os.environ


def _job(tmp_path):
    folder = tmp_path / "T2_04"
    folder.mkdir()
    ctx_path = tmp_path / "workflow_context.json"
    ctx = {"aoi_features": [{"folder_path": str(folder)}]}
    return ctx_path, ctx, folder / "workflow_context.json"


def _fimcore_writes_the_key(feat_ctx_path, ctx_path, fail=False):
    """Stand-in for run_arc_flowfile_for_all_aois: it saves the key in the
    AOI context (nencarta_streamflow) and the project summary, like fimcore."""
    def run(path, ctx, per_aoi_configs=None, log_fn=None):
        feat_ctx_path.write_text(json.dumps(
            {"nencarta_streamflow": {"streamflow_source": "NWM_short_range",
                                     "nwm_api_key": KEY}}))
        ctx["arc_flow_per_aoi"] = [{"name": "T2_04", "nwm_api_key": KEY}]
        ctx_path.write_text(json.dumps(ctx))
        if fail:
            raise RuntimeError("NWM fetch failed")
    return run


@pytest.mark.parametrize("fail", [False, True])
def test_the_key_never_stays_in_a_context_file(monkeypatch, tmp_path, fail):
    import fimcore.arc_orchestrate as arc
    ctx_path, ctx, feat_ctx_path = _job(tmp_path)
    monkeypatch.setattr(arc, "run_arc_flowfile_for_all_aois",
                        _fimcore_writes_the_key(feat_ctx_path, ctx_path, fail))

    try:
        REGISTRY["astream"].execute(str(ctx_path), ctx, OK, lambda *a: None)
    except RuntimeError:
        assert fail

    for path in (feat_ctx_path, ctx_path):
        assert KEY not in path.read_text()
    assert KEY not in json.dumps(ctx)
    saved = json.loads(feat_ctx_path.read_text())
    assert saved["nencarta_streamflow"] == {"streamflow_source": "NWM_short_range"}


# ── submit guard ─────────────────────────────────────────────────────────────

def _aoi_with_flowline(source):
    aoi = _fake_aoi([("aflow", "succeeded", False)])
    aoi.step_runs[0].config = {"source": source}
    aoi.name = "T2_04"
    return aoi


def test_nwm_without_a_portal_key_is_refused():
    reason = guards.check_a2f_streamflow_submit(_aoi_with_flowline("nhd"), OK, False)
    assert "CIROH NWM API key" in reason and "GEOGLOWS" in reason


def test_geoglows_after_a_picked_nhd_network_is_refused():
    aoi = _aoi_with_flowline("prepared")
    reason = guards.check_a2f_streamflow_submit(aoi, {**OK, "source": "geoglows"}, True)
    assert "NWM flows only" in reason


@pytest.mark.parametrize("flowline, cfg, key", [
    ("nhd", OK, True),
    ("prepared", OK, True),
    ("nhd", {**OK, "source": "geoglows"}, False),   # GEOGLOWS needs no key
])
def test_allowed_combinations_pass(flowline, cfg, key):
    assert guards.check_a2f_streamflow_submit(_aoi_with_flowline(flowline), cfg, key) is None


def test_an_unreadable_context_file_is_removed_not_left_with_the_key(tmp_path):
    from tethysapp.fimsim_gui.job_types.steps_a2f import scrub_nwm_key
    ctx_path, ctx, feat_ctx_path = _job(tmp_path)
    feat_ctx_path.write_text('{"nencarta_streamflow": {"nwm_api_key": "' + KEY)  # truncated

    scrub_nwm_key(ctx, str(ctx_path))

    assert not feat_ctx_path.exists()


def _aoi_with_streamflow(source):
    aoi = _fake_aoi([("astream", "succeeded", False)])
    aoi.step_runs[0].config = {"source": source}
    return aoi


def test_run_with_nwm_flows_needs_the_key_at_run_time():
    reason = guards.check_a2f_run_submit(_aoi_with_streamflow("nwm"), nwm_key_set=False)
    assert "CIROH NWM API key" in reason


@pytest.mark.parametrize("source, key", [("nwm", True), ("geoglows", False)])
def test_run_allowed_with_a_key_or_with_geoglows(source, key):
    assert guards.check_a2f_run_submit(_aoi_with_streamflow(source), key) is None
