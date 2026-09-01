"""FIMSIM-BE5 unit tests: marker parsing + LogAdapter behavior.

The adapter is exercised against fakes (a recording session + StepRun stand-in)
so cancellation/timeout/flush logic is tested without Dask or Postgres. The
end-to-end path (real scheduler, worker, MinIO, 3DEP) runs via
scripts/dev_submit_dem.py — see docs/dev-jobs.md.
"""
from types import SimpleNamespace

import pytest

from tethysapp.fimsim_gui.jobs import (
    JobCancelled, JobTimeout, LogAdapter, parse_marker,
)


# ── Marker parsing ────────────────────────────────────────────────────────────

def test_parse_step_markers():
    e = parse_marker("▶ DEM [1/3]: 'AOI_1' …")
    assert e == {**e, "stage": "dem", "status": "started", "current": 1, "total": 3}
    e = parse_marker("✓ DEM [3/3] finished: 'AOI_3'")
    assert e["status"] == "finished" and e["current"] == 3
    e = parse_marker("✗ PAR [2/2] failed for 'AOI_2': boom")
    assert e["status"] == "failed" and e["stage"] == "par"


def test_parse_download_counter():
    e = parse_marker("  Download progress: 2/5")
    assert e == {**e, "stage": "download", "current": 2, "total": 5}


def test_parse_plain_lines_are_not_events():
    assert parse_marker("DEM destination CRS: EPSG:26917") is None
    assert parse_marker("All 1 AOI(s) processed successfully.") is None


# ── LogAdapter against fakes ──────────────────────────────────────────────────

class FakeSession:
    def __init__(self, run):
        self._run = run
        self.commits = 0

    def commit(self):
        self.commits += 1

    def expire(self, obj, fields):
        pass  # run.status is mutated directly by tests


def _adapter(deadline=None, clock=None):
    run = SimpleNamespace(status="running", progress=None, log=None)
    session = FakeSession(run)
    times = {"t": 0.0}

    def fake_clock():
        times["t"] += 1.0
        return times["t"]

    a = LogAdapter(session, run, deadline=deadline,
                   flush_interval=0, cancel_interval=0,
                   clock=clock or fake_clock)
    return a, run, session


def test_adapter_collects_events_and_log():
    a, run, session = _adapter()
    a("▶ DEM [1/1]: 'AOI_1' …")
    a("DEM destination CRS: EPSG:26917")
    a("✓ DEM [1/1] finished: 'AOI_1'")
    assert [e["status"] for e in run.progress] == ["started", "finished"]
    assert "destination CRS" in run.log
    assert session.commits >= 2


def test_adapter_raises_on_cancel():
    a, run, _ = _adapter()
    a("line one")
    run.status = "cancelled"
    with pytest.raises(JobCancelled):
        a("line two")


def test_adapter_raises_on_timeout():
    a, run, _ = _adapter(deadline=2.5)  # fake clock ticks 1s per call
    a("ok at t=1")
    a("ok-ish at t=2")  # cancel check passes, then deadline still ahead? t=2 < 2.5
    with pytest.raises(JobTimeout):
        a("t=3 exceeds deadline")


def test_adapter_caps_progress_events():
    from tethysapp.fimsim_gui.jobs import PROGRESS_EVENT_CAP
    a, run, _ = _adapter()
    for i in range(PROGRESS_EVENT_CAP + 50):
        a(f"▶ DEM [{i + 1}/{PROGRESS_EVENT_CAP + 50}]: x")
    assert len(run.progress) == PROGRESS_EVENT_CAP
    assert run.progress[-1]["current"] == PROGRESS_EVENT_CAP + 50


def test_adapter_bounds_log_size():
    a, run, _ = _adapter()
    for i in range(300):
        a("x" * 1000)
    assert len(run.log) <= 100_000


def test_adapter_records_failure_markers():
    a, run, _ = _adapter()
    a("▶ Manning [1/1]: 'Neuse' …")
    a("✗ Manning [1/1] ERROR for 'Neuse': lulc.ascii not found")
    assert a.failure_messages and "lulc.ascii" in a.failure_messages[0]


def test_adapter_cancel_latches():
    a, run, _ = _adapter()
    a("line")
    run.status = "cancelled"
    with pytest.raises(JobCancelled):
        a("first raise")
    # fimcore's per-AOI except swallows the first raise and keeps logging —
    # every subsequent call must raise again, no throttle
    with pytest.raises(JobCancelled):
        a("orchestrator kept going")
    with pytest.raises(JobCancelled):
        a("and going")
