"""FIMSIM-BE7 unit tests: registry table, dependency guards, supersede cascade."""
from types import SimpleNamespace

import pytest

from tethysapp.fimsim_gui.job_types import REGISTRY
from tethysapp.fimsim_gui.jobs import prerequisites_missing, supersede_step_and_downstream
from tethysapp.fimsim_gui.models import STEP_KEYS


def test_registry_covers_the_wizard_steps():
    assert set(REGISTRY) == {"dem", "manning", "bci", "bdy", "par", "run"}
    assert REGISTRY["dem"].requires == ()
    assert REGISTRY["manning"].requires == ("dem",)
    assert REGISTRY["bci"].requires == ("dem",)
    assert REGISTRY["bdy"].requires == ("bci",)
    assert REGISTRY["par"].requires == ("bdy",)
    assert REGISTRY["run"].requires == ("par",)
    for key, jt in REGISTRY.items():
        assert jt.step_key == key
        assert isinstance(jt.defaults(), dict)


def _fake_aoi(runs):
    """runs: list of (step_key, status, superseded)."""
    step_runs = [SimpleNamespace(step_key=k, status=s, superseded=sup)
                 for k, s, sup in runs]

    def current(step_key):
        cands = [r for r in step_runs if r.step_key == step_key and not r.superseded]
        return cands[-1] if cands else None

    return SimpleNamespace(step_runs=step_runs, current_step_run=current)


def test_guard_blocks_until_prereq_succeeds():
    aoi = _fake_aoi([])
    assert prerequisites_missing(aoi, "dem") == []
    assert prerequisites_missing(aoi, "manning") == ["dem"]

    aoi = _fake_aoi([("dem", "running", False)])
    assert prerequisites_missing(aoi, "manning") == ["dem"]

    aoi = _fake_aoi([("dem", "succeeded", False)])
    assert prerequisites_missing(aoi, "manning") == []
    assert prerequisites_missing(aoi, "bdy") == ["bci"]


def test_guard_ignores_superseded_success():
    aoi = _fake_aoi([("dem", "succeeded", True), ("dem", "failed", False)])
    assert prerequisites_missing(aoi, "manning") == ["dem"]


def test_supersede_cascades_downstream_only():
    aoi = _fake_aoi([
        ("dem", "succeeded", False),
        ("manning", "succeeded", False),
        ("bci", "succeeded", False),
        ("bdy", "succeeded", False),
        ("par", "succeeded", False),
    ])
    n = supersede_step_and_downstream(aoi, "bci")
    assert n == 3  # bci, bdy, par — dem and manning untouched
    by_key = {r.step_key: r.superseded for r in aoi.step_runs}
    assert by_key == {"dem": False, "manning": False,
                      "bci": True, "bdy": True, "par": True}


def test_supersede_order_matches_wizard():
    assert STEP_KEYS == ("dem", "manning", "bci", "bdy", "par", "run")


def test_bdy_requires_event_window():
    with pytest.raises(ValueError, match="start_dt"):
        REGISTRY["bdy"].transform_config(REGISTRY["bdy"].defaults(), ctx=None)


def test_bdy_parses_iso_datetimes():
    cfg = {**REGISTRY["bdy"].defaults(),
           "start_dt": "2016-10-08T00:00:00", "end_dt": "2016-10-12T00:00:00"}
    out = REGISTRY["bdy"].transform_config(cfg, ctx=None)
    assert out["start_dt"].year == 2016 and out["end_dt"].day == 12
