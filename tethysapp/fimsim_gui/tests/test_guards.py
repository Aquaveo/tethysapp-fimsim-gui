"""FIMSIM-BE10 guard tests — precheck math, concurrency, reaper, retention."""
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from tethysapp.fimsim_gui import guards

NEUSE_WKT = (
    "SRID=4326;POLYGON((-78.10992 35.45282,-77.93055 35.44839,"
    "-77.93668 35.28632,-78.1157 35.29072,-78.10992 35.45282))"
)


def _neuse_aoi():
    from geoalchemy2.shape import from_shape
    from shapely import wkt
    geom = wkt.loads(NEUSE_WKT.split(";", 1)[1])
    return SimpleNamespace(
        name="Neuse", geometry=from_shape(geom, srid=4326),
        working_crs_epsg=26917, current_step_run=lambda k: None)


# ── DEM dimension precheck ────────────────────────────────────────────────────

def test_predicted_cells_scales_with_resolution():
    aoi = _neuse_aoi()
    c10 = guards.predicted_dem_cells(aoi, 10)
    c90 = guards.predicted_dem_cells(aoi, 90)
    # Neuse bbox ≈ 16.3 × 18.1 km → ~3M cells at 10 m, ~36k at 90 m
    assert 2_500_000 < c10 < 3_500_000
    assert 30_000 < c90 < 45_000
    assert abs(c10 / c90 - 81) < 8  # 9x finer per axis


def test_dem_guard_rejects_fine_resolution_on_big_area():
    aoi = _neuse_aoi()
    assert guards.check_dem_submit(aoi, {"dem_res_m": 90}, guards.DEFAULT_MAX_DEM_CELLS) is None
    reason = guards.check_dem_submit(aoi, {"dem_res_m": 1}, guards.DEFAULT_MAX_DEM_CELLS)
    assert reason and "megacell" in reason and "coarser" in reason.lower()


# ── run-time estimate ─────────────────────────────────────────────────────────

def test_run_guard_uses_be8_characterization():
    aoi = _neuse_aoi()
    dem = SimpleNamespace(config={"dem_res_m": 90})
    par = SimpleNamespace(config={"sim_time": 345600})  # 4 days
    aoi.current_step_run = lambda k: {"dem": dem, "par": par}.get(k)
    # measured 10.6s; estimate with 4x margin must pass a 1h budget easily
    assert guards.check_run_submit(aoi, {}, timeout_s=3600) is None
    # 1m grid + 4-day sim: ~2.9e8 cells × 4d × 3e-4 ≈ 97h — must reject
    dem.config = {"dem_res_m": 1}
    reason = guards.check_run_submit(aoi, {}, timeout_s=3600)
    assert reason and "estimated" in reason


def test_run_guard_never_blocks_without_data():
    aoi = _neuse_aoi()  # no dem/par runs
    assert guards.check_run_submit(aoi, {}, 3600) is None


# ── reaper + retention (fake session) ─────────────────────────────────────────

class FakeQuery:
    def __init__(self, rows): self._rows = rows
    def filter(self, *a): return self
    def all(self): return self._rows


class FakeSession:
    def __init__(self, rows): self._rows = rows; self.committed = False
    def query(self, *a): return FakeQuery(self._rows)
    def commit(self): self.committed = True


def _run(status="running", minutes_ago=240, progress=None, superseded=False,
         finished=None, manifest=None):
    t = datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)
    return SimpleNamespace(status=status, progress=progress, started=t,
                           created=t, superseded=superseded, finished=finished,
                           manifest=manifest, error=None)


def test_reaper_fails_only_silent_runs():
    fresh_event = [{"at": datetime.now(timezone.utc).isoformat()}]
    silent = _run(minutes_ago=240)
    alive = _run(minutes_ago=240, progress=fresh_event)
    done = _run(status="succeeded", minutes_ago=600)
    s = FakeSession([silent, alive])  # query pre-filtered to active in real code
    n = guards.reap_stale_runs(s)
    assert n == 1 and silent.status == "failed" and "worker likely died" in silent.error
    assert alive.status == "running" and done.status == "succeeded"


def test_retention_targets_superseded_and_old():
    old = _run(status="succeeded", superseded=False,
               finished=datetime.now(timezone.utc) - timedelta(days=60),
               manifest=[{"key": "k1", "name": "a.tif", "bytes": 100}])
    superseded = _run(status="succeeded", superseded=True,
                      finished=datetime.now(timezone.utc),
                      manifest=[{"key": "k2", "name": "b.tif", "bytes": 50}])
    recent = _run(status="succeeded", superseded=False,
                  finished=datetime.now(timezone.utc),
                  manifest=[{"key": "k3", "name": "c.tif", "bytes": 7}])
    s = FakeSession([old, superseded, recent])

    class FakeStorage:
        deleted = []
        def delete(self, key): self.deleted.append(key)

    st = FakeStorage()
    freed = guards.clean_expired_artifacts(s, st, retention_days=30)
    assert set(st.deleted) == {"k1", "k2"} and freed == 150
    assert old.manifest.get("expired") and superseded.manifest.get("expired")
    assert recent.manifest[0]["key"] == "k3"
    # idempotent: second pass deletes nothing
    st.deleted.clear()
    assert guards.clean_expired_artifacts(s, st, retention_days=30) == 0
    assert st.deleted == []
