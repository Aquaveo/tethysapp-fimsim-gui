"""FIMSIM-BE5 unit tests: marker parsing + LogAdapter behavior.

The adapter is exercised against fakes (a recording session + StepRun stand-in)
so cancellation/timeout/flush logic is tested without Dask or Postgres. The
end-to-end path (real scheduler, worker, MinIO, 3DEP) runs via
scripts/dev_submit_dem.py — see docs/dev-jobs.md.
"""
from types import SimpleNamespace

import pytest

from tethysapp.fimsim_gui.jobs import (
    JobCancelled, JobTimeout, LogAdapter, _save_pending_log, parse_marker,
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
    for _i in range(300):
        a("x" * 1000)
    assert len(run.log) <= 100_000


def test_adapter_records_failure_markers():
    a, run, _ = _adapter()
    a("▶ Manning [1/1]: 'Neuse' …")
    a("✗ Manning [1/1] ERROR for 'Neuse': lulc.ascii not found")
    assert a.failure_messages and "lulc.ascii" in a.failure_messages[0]


def _buffering_adapter():
    """An adapter that has not written its latest lines yet (as between the
    worker's periodic flushes)."""
    run = SimpleNamespace(status="running", progress=None, log=None)
    session = FakeSession(run)
    a = LogAdapter(session, run, flush_interval=3600, cancel_interval=3600,
                   clock=lambda: 0.0)
    return a, run, session


def test_a_failing_job_keeps_the_lines_that_explain_it():
    a, run, session = _buffering_adapter()
    a("  ⚠ could not reproject the flood maps: aoi.geojson: No such file")
    assert run.log is None

    _save_pending_log(a, session)

    assert "could not reproject" in run.log


def test_a_failed_log_save_never_replaces_the_jobs_error():
    a, run, session = _buffering_adapter()
    a("line")
    rolled_back = []

    def broken_commit():
        raise RuntimeError("database gone")
    session.commit = broken_commit
    session.rollback = lambda: rolled_back.append(True)

    _save_pending_log(a, session)  # must not raise
    assert rolled_back == [True]


def test_a_dead_connection_never_replaces_the_jobs_error():
    a, run, session = _buffering_adapter()
    a("line")

    def gone():
        raise RuntimeError("connection closed")
    session.commit = gone
    session.rollback = gone

    _save_pending_log(a, session)  # must not raise


def test_no_adapter_yet_is_fine():
    _save_pending_log(None, FakeSession(None))


def test_run_step_job_saves_the_last_lines_before_it_marks_the_run_failed(monkeypatch):
    """The wiring: a job that logs and then raises has its last line in the
    run's log by the time the run is finalized (which rolls back)."""
    import sqlalchemy
    import sqlalchemy.orm

    from tethysapp.fimsim_gui import jobs, job_types, storage

    run = SimpleNamespace(status="queued", progress=None, log=None, config={},
                          step_key="fake_step", started=None,
                          aoi=SimpleNamespace(id=1, project=SimpleNamespace(
                              username="u", id=1)))
    session = FakeSession(run)
    session.rollback = lambda: None
    session.close = lambda: None

    class FailingStep:
        derived_config_keys = ()

        def prepare(self, scratch, aoi_file, log_fn):
            return str(scratch / "ctx.json"), {}

        def clean_workspace(self, ctx, log_fn):
            pass

        def prestage_shared_cache(self, storage, ctx, log_fn):
            pass

        def prestage_inputs(self, storage, ctx, cfg, log_fn):
            pass

        def execute(self, ctx_path, ctx, cfg, log_fn):
            log_fn("starting NenCarta")  # the first line is written at once
            log_fn("⚠ could not reproject the flood maps")  # still buffered
            raise RuntimeError("produced no flood depth map")

    logged_at_finalize = []
    monkeypatch.setattr(sqlalchemy, "create_engine",
                        lambda url: SimpleNamespace(dispose=lambda: None))
    monkeypatch.setattr(sqlalchemy.orm, "sessionmaker",
                        lambda bind: lambda: session)
    monkeypatch.setattr(jobs, "_ensure_django", lambda: None)
    monkeypatch.setattr(jobs, "_sanity_check_proj", lambda: None)
    monkeypatch.setattr(jobs, "_load_step_run", lambda s, i: run)
    monkeypatch.setattr(jobs, "_write_aoi_geojson", lambda aoi, dest: dest)
    monkeypatch.setattr(jobs, "_restore_workspace", lambda *a: None)
    monkeypatch.setattr(jobs, "_finalize",
                        lambda s, i, status, error: logged_at_finalize.append(run.log))
    monkeypatch.setattr(storage, "service_from_config", lambda cfg: None)
    monkeypatch.setitem(job_types.REGISTRY, "fake_step", FailingStep())

    result = jobs.run_step_job("sqlite://", {}, 7)

    assert result["status"] == "failed"
    assert "could not reproject" in logged_at_finalize[0]


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


def test_nhd_comids_reads_whichever_id_column_the_service_returned():
    # FIMSIM-BE25: the main river's NHDPlus COMIDs are the NWM feature IDs the
    # Streamflow tool prefills (same column search as fimcore.flowline_mode)
    pd = pytest.importorskip("pandas")
    from tethysapp.fimsim_gui.jobs import nhd_comids
    assert nhd_comids(pd.DataFrame({"COMID": [8781135, 8781135, 8781137.0]})) == [8781135, 8781137]
    assert nhd_comids(pd.DataFrame({"nhdplusid": ["5", "x", None]})) == [5]
    assert nhd_comids(pd.DataFrame({"geometry": [1]})) == []
    assert nhd_comids(None) == [] and nhd_comids(pd.DataFrame()) == []
    # an infinite float is not an ID (int(inf) raises OverflowError)
    assert nhd_comids(pd.DataFrame({"COMID": [float("inf"), 7.0]})) == [7]


def _fimcore_flowlines(with_hydroseq=True):
    """A clipped NHD flowline table shaped like fimcore's
    lookup_nhd_flowlines_clipped output (pynhd flowline_mr columns, EPSG:4326):
    the Lumber River main stem split in three reaches listed out of order,
    plus a short low-order tributary."""
    gpd = pytest.importorskip("geopandas")
    from shapely.geometry import LineString
    rows = [
        # (COMID, StreamOrde, GNIS_NAME, Hydroseq, line)
        (9001, 5, "Lumber River", 300, [(-79.00, 34.65), (-78.97, 34.62)]),   # middle
        (9002, 2, "Bear Swamp", 900, [(-79.03, 34.69), (-79.02, 34.67)]),     # tributary
        (9003, 5, "Lumber River", 400, [(-79.04, 34.69), (-79.00, 34.65)]),   # upstream
        (9004, 5, "Lumber River", 200, [(-78.97, 34.62), (-78.95, 34.60)]),   # downstream
    ]
    data = {"COMID": [r[0] for r in rows], "StreamOrde": [r[1] for r in rows],
            "GNIS_NAME": [r[2] for r in rows]}
    if with_hydroseq:
        data["Hydroseq"] = [r[3] for r in rows]
    return gpd.GeoDataFrame(data, geometry=[LineString(r[4]) for r in rows],
                            crs="EPSG:4326")


def _fimcore_main_river(flowlines):
    """fimcore's main_gdf: ONE merged row, no ID column."""
    gpd = pytest.importorskip("geopandas")
    from shapely.ops import linemerge
    main = flowlines[flowlines["GNIS_NAME"] == "Lumber River"]
    return gpd.GeoDataFrame([{"river_name": "Lumber River", "stream_order": 5}],
                            geometry=[linemerge(list(main.geometry))], crs=flowlines.crs)


def test_main_river_row_from_fimcore_carries_no_reach_ids():
    # the C1 bug: fimcore's merged main-river row has no COMID column
    from tethysapp.fimsim_gui.jobs import nhd_comids
    assert nhd_comids(_fimcore_main_river(_fimcore_flowlines())) == []


def test_main_stem_reach_ids_are_the_main_river_comids_upstream_first():
    from tethysapp.fimsim_gui.jobs import main_stem_reach_ids
    flowlines = _fimcore_flowlines()
    # Hydroseq descending = upstream → downstream; the tributary is left out
    assert main_stem_reach_ids(flowlines, _fimcore_main_river(flowlines)) == [9003, 9001, 9004]


def test_main_stem_reach_ids_keep_flowline_order_without_hydroseq():
    from tethysapp.fimsim_gui.jobs import main_stem_reach_ids
    flowlines = _fimcore_flowlines(with_hydroseq=False)
    assert main_stem_reach_ids(flowlines, None) == [9001, 9003, 9004]


def test_main_stem_reach_ids_never_raise(monkeypatch):
    # the lookup must never fail because of the prefill IDs
    import fimcore.bci as bci
    from tethysapp.fimsim_gui.jobs import main_stem_reach_ids
    flowlines = _fimcore_flowlines()
    assert main_stem_reach_ids(None, None) == []
    assert main_stem_reach_ids(flowlines.iloc[0:0], None) == []
    assert main_stem_reach_ids(flowlines.drop(columns=["COMID"]), None) == []

    def boom(_gdf):
        raise RuntimeError("Could not create a valid main river line.")
    monkeypatch.setattr(bci, "_build_main_river", boom)
    # fimcore's picker failed: fall back to the main-river row's name
    assert main_stem_reach_ids(flowlines, _fimcore_main_river(flowlines)) == [9003, 9001, 9004]
    assert main_stem_reach_ids(flowlines, None) == []
    assert main_stem_reach_ids(object(), object()) == []


# ── FIMSIM-BE19: a worker must not give up on a step run the web request
#    has not committed yet (the LULC run that sat in "queued" forever at the
#    2026-10-21 demo) ───────────────────────────────────────────────────────────

class _FlakySession:
    """A session whose lookup returns None for the first `misses` calls —
    the uncommitted-row window a warm worker can hit."""

    def __init__(self, misses, row="row"):
        self.misses = misses
        self.row = row
        self.calls = 0
        self.rolled_back = 0

    def rollback(self):
        self.rolled_back += 1


def test_load_step_run_retries_until_the_row_is_visible(monkeypatch):
    from tethysapp.fimsim_gui import jobs
    sess = _FlakySession(misses=2)

    def fetch(session, steprun_id):
        session.calls += 1
        return None if session.calls <= session.misses else session.row

    monkeypatch.setattr(jobs, "_fetch_step_run", fetch)
    slept = []
    monkeypatch.setattr(jobs.time, "sleep", slept.append)
    assert jobs._load_step_run(sess, 255, attempts=5, delay_s=0.5) == "row"
    assert sess.calls == 3
    assert slept == [0.5, 0.5]            # one pause per miss, none after the hit
    assert sess.rolled_back == 2          # a fresh snapshot per retry (READ COMMITTED)


def test_load_step_run_gives_up_after_the_attempts(monkeypatch):
    from tethysapp.fimsim_gui import jobs
    sess = _FlakySession(misses=99)
    monkeypatch.setattr(jobs, "_fetch_step_run",
                        lambda session, steprun_id: None)
    monkeypatch.setattr(jobs.time, "sleep", lambda *_: None)
    assert jobs._load_step_run(sess, 255, attempts=3, delay_s=0) is None


# ── FIMSIM-BE23: dates a picked flow series brings are saved back onto the
#    run's config (for the summary line and the hydrograph date axis) ─────────

def test_derived_config_saves_only_the_declared_keys():
    from tethysapp.fimsim_gui.jobs import derived_config
    jt = SimpleNamespace(derived_config_keys=("start_dt", "end_dt"))
    submitted = {"bdy_source": "prepared", "prepared_id": 12}
    # prestage_inputs mutated cfg: dates from the CSV + the staged worker path
    cfg = {**submitted, "start_dt": "2016-10-08T00:00:00",
           "end_dt": "2016-10-12T00:00:00", "file_path": "/tmp/fimsim-job-7/q.csv"}
    saved = derived_config(jt, submitted, cfg)
    assert saved == {"bdy_source": "prepared", "prepared_id": 12,
                     "start_dt": "2016-10-08T00:00:00",
                     "end_dt": "2016-10-12T00:00:00"}
    assert "file_path" not in saved          # a worker path never reaches the DB
    assert saved is not submitted and submitted == {"bdy_source": "prepared",
                                                    "prepared_id": 12}


def test_derived_config_overrides_submitted_dates():
    # a picked series' own window wins over dates left in the submitted config
    from tethysapp.fimsim_gui.jobs import derived_config
    jt = SimpleNamespace(derived_config_keys=("start_dt", "end_dt"))
    submitted = {"start_dt": "2020-01-01", "end_dt": "2020-01-02"}
    cfg = {"start_dt": "2016-10-08T00:00:00", "end_dt": "2016-10-12T00:00:00"}
    assert derived_config(jt, submitted, cfg) == cfg


def test_derived_config_is_none_when_nothing_was_derived():
    # no save (and no extra commit) for steps without derived keys, or when
    # staging set none of them
    from tethysapp.fimsim_gui.jobs import derived_config
    cfg = {"bdy_source": "nwm_retro", "file_path": "/tmp/x.csv"}
    assert derived_config(SimpleNamespace(derived_config_keys=()), cfg, cfg) is None
    jt = SimpleNamespace(derived_config_keys=("start_dt", "end_dt"))
    assert derived_config(jt, {"bdy_source": "nwm_retro"}, cfg) is None


def test_bdy_step_saves_its_series_dates_but_not_the_staged_path():
    from tethysapp.fimsim_gui.job_types import REGISTRY
    from tethysapp.fimsim_gui.jobs import derived_config
    jt = REGISTRY["bdy"]
    submitted = {"bdy_source": "prepared"}
    cfg = {**submitted, "file_path": "/w/q.csv",
           "start_dt": "2016-10-08T00:00:00", "end_dt": "2016-10-12T00:00:00"}
    saved = derived_config(jt, submitted, cfg)
    assert saved["start_dt"] == "2016-10-08T00:00:00"
    assert saved["end_dt"] == "2016-10-12T00:00:00"
    assert "file_path" not in saved
