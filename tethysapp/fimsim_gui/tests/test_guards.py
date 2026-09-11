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
    def __init__(self, rows):
        self._rows = rows
        self.committed = False

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


def test_shared_cache_eviction_age_then_size():
    now = datetime.now(timezone.utc)

    class FakeStorage:
        def __init__(self):
            self.objs = {  # key: (size, mtime)
                "_shared_cache/3dep/old.tif": (100, now - timedelta(days=120)),
                "_shared_cache/3dep/big1.tif": (int(9e9), now - timedelta(days=10)),
                "_shared_cache/3dep/big2.tif": (int(9e9), now - timedelta(days=5)),
                "_shared_cache/3dep/small.tif": (int(1e9), now - timedelta(days=1)),
            }

        def list_prefix_with_sizes(self, prefix):
            return [(k, v[0]) for k, v in self.objs.items() if k.startswith(prefix)]

        def modified_time(self, key): return self.objs[key][1]

        def delete(self, key): self.objs.pop(key, None)

    st = FakeStorage()
    freed = guards.evict_shared_cache(st, max_age_days=90, max_total_gb=10.0)
    # old.tif dies by age; then big1 (oldest remaining) dies to fit 10GB
    assert "_shared_cache/3dep/old.tif" not in st.objs
    assert "_shared_cache/3dep/big1.tif" not in st.objs
    assert "_shared_cache/3dep/big2.tif" in st.objs
    assert "_shared_cache/3dep/small.tif" in st.objs
    assert freed == 100 + int(9e9)


def test_shared_cache_key_scheme():
    from tethysapp.fimsim_gui.storage import StorageKeyError, assert_owned, shared_cache_key
    key = shared_cache_key("3dep", "USGS_13_n36w078.tif")
    assert key == "_shared_cache/3dep/USGS_13_n36w078.tif"
    with pytest.raises(StorageKeyError):
        shared_cache_key("../evil", "x.tif")
    with pytest.raises(StorageKeyError):
        assert_owned(key, "reshma")  # no user can ever own cache keys


def test_dem_cache_prestage_and_poststage(tmp_path):
    """The BE11 staging mechanics, storage-faked: needed tiles come down,
    new full tiles go up, AOI-window files never enter the shared cache."""
    import json as _json

    from tethysapp.fimsim_gui.job_types.steps import DEMStepJobType

    # fimcore-shaped ctx for one AOI whose bbox spans two 1° tiles
    proj = tmp_path / "job"
    folder = proj / "Neuse"
    folder.mkdir(parents=True)
    aoi_file = proj / "aoi.geojson"
    aoi_file.write_text(_json.dumps({
        "type": "FeatureCollection",
        "features": [{"type": "Feature", "properties": {},
                      "geometry": {"type": "Polygon", "coordinates": [[
                          [-78.1, 35.3], [-77.9, 35.3], [-77.9, 35.45],
                          [-78.1, 35.45], [-78.1, 35.3]]]}}],
    }))
    ctx = {"aoi_features": [{
        "folder_path": str(folder), "folder_name": "Neuse",
        "source_file": str(aoi_file),
    }]}

    class FakeStorage:
        def __init__(self): self.objs = {}

        def exists(self, k): return k in self.objs

        def download_to_path(self, k, dest):
            from pathlib import Path
            Path(dest).parent.mkdir(parents=True, exist_ok=True)
            Path(dest).write_bytes(self.objs[k])

        def save(self, k, fh): self.objs[k] = fh.read()

    st = FakeStorage()
    jt = DEMStepJobType()
    logs = []

    # cold: nothing cached → prestage is a no-op
    jt.prestage_shared_cache(st, ctx, logs.append)
    if (proj / "DEM_raw_Neuse").exists():
        assert not list((proj / "DEM_raw_Neuse").glob("*"))

    # simulate fimcore's full-tile fallback output + a windowed file
    tiles = proj / "DEM_raw_Neuse"
    tiles.mkdir()
    (tiles / "USGS_13_n36w079.tif").write_bytes(b"FULLTILE" * 10)
    (tiles / "USGS_13_n36w079_aoi.tif").write_bytes(b"WINDOWED")
    jt.poststage_shared_cache(st, ctx, logs.append)
    assert "_shared_cache/3dep/USGS_13_n36w079.tif" in st.objs
    assert not any("_aoi" in k for k in st.objs)          # windows never cached
    assert any("contributed 1" in line for line in logs)

    # warm: a fresh job dir gets the tile pre-staged
    (tiles / "USGS_13_n36w079.tif").unlink()
    jt.prestage_shared_cache(st, ctx, logs.append)
    assert (tiles / "USGS_13_n36w079.tif").read_bytes() == b"FULLTILE" * 10
    assert any("staged 1" in line for line in logs)


def test_retention_never_deletes_keys_live_runs_still_reference():
    # superseded and current runs share keys (same aoi/step/filename)
    shared_key = "u/1/1/bdy/Neuse.bdy"
    superseded = _run(status="succeeded", superseded=True,
                      finished=datetime.now(timezone.utc),
                      manifest=[
                          {"key": shared_key, "name": "Neuse.bdy", "bytes": 10},
                          {"key": "u/1/1/bdy/old_only.csv",
                           "name": "old_only.csv", "bytes": 5}])
    current = _run(status="succeeded", superseded=False,
                   finished=datetime.now(timezone.utc),
                   manifest=[{"key": shared_key, "name": "Neuse.bdy", "bytes": 10}])
    s = FakeSession([superseded, current])

    class FakeStorage:
        deleted = []
        def delete(self, key): self.deleted.append(key)

    st = FakeStorage()
    guards.clean_expired_artifacts(s, st, retention_days=30)
    assert st.deleted == ["u/1/1/bdy/old_only.csv"]  # the shared key survives
    assert current.manifest[0]["key"] == shared_key
