"""FIMSIM-BE5: the job wrapper — how a StepRun becomes work on a Dask worker.

Submit side (web process): :func:`submit_step` builds a dask.delayed around
:func:`run_step_job` with only serializable primitives (DB URL, storage config
dict, steprun id) and executes it through a Tethys DaskJob on the
``dask_primary`` scheduler — one job per AOI (fan-out).

Worker side: :func:`run_step_job` opens its own DB session, materializes the
AOI geometry to a scratch GeoJSON, runs the registered fimcore step with an
injected ``log_fn`` adapter, uploads outputs through the BE4 storage service,
and finalizes the StepRun. The adapter converts fimcore's log-marker
convention into structured progress events persisted on the StepRun — the
browser polls rows; nothing downstream regex-parses logs.

Cancellation is cooperative (the desktop's WorkerCancelled pattern): the
adapter re-reads StepRun.status at most every 2 s and raises inside log_fn
when a cancel was requested. Timeouts ride the same check.
"""
import json
import re
import shutil
import tempfile
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path

DEFAULT_TIMEOUT_S = 2 * 3600  # BE10 formalizes per-step budgets
PROGRESS_EVENT_CAP = 200      # keep the JSON column bounded


class JobCancelled(Exception):
    pass


class JobTimeout(Exception):
    pass


# ── Marker parsing (fimcore's log conventions → structured events) ───────────

_STEP_MARKER = re.compile(r"^\s*([▶✓✗])\s+([A-Za-z_]+)\s+\[(\d+)/(\d+)\]")
_COUNTER = re.compile(r"(?:Download|progress)[^0-9]*?(\d+)\s*/\s*(\d+)", re.IGNORECASE)


def parse_marker(line: str):
    """Return a progress event dict for a recognized marker line, else None."""
    m = _STEP_MARKER.match(line)
    if m:
        sym, stage, cur, total = m.groups()
        status = {"▶": "started", "✓": "finished", "✗": "failed"}[sym]
        return {"stage": stage.lower(), "status": status,
                "current": int(cur), "total": int(total),
                "message": line.strip()}
    m = _COUNTER.search(line)
    if m:
        return {"stage": "download", "status": "running",
                "current": int(m.group(1)), "total": int(m.group(2)),
                "message": line.strip()}
    return None


class LogAdapter:
    """The ``log_fn`` handed to fimcore: parses markers into events, buffers
    log lines, flushes to the StepRun row (throttled), and enforces
    cancellation + timeout cooperatively."""

    def __init__(self, session, step_run, deadline=None,
                 flush_interval=1.0, cancel_interval=2.0, clock=time.monotonic):
        self._session = session
        self._run = step_run
        self._deadline = deadline
        self._flush_interval = flush_interval
        self._cancel_interval = cancel_interval
        self._clock = clock
        self._events = list(step_run.progress or [])
        self._log_lines = []
        self._last_flush = 0.0
        self._last_cancel_check = 0.0
        self._cancel_latched = False
        self.failure_messages = []  # ✗ markers — fimcore orchestrators swallow
                                    # per-AOI exceptions, so the wrapper checks this

    def __call__(self, line):
        line = str(line)
        event = parse_marker(line)
        if event:
            event["at"] = datetime.now(timezone.utc).isoformat()
            self._events.append(event)
            self._events = self._events[-PROGRESS_EVENT_CAP:]
            if event["status"] == "failed":
                self.failure_messages.append(event["message"])
        else:
            self._log_lines.append(line)

        now = self._clock()
        if now - self._last_flush >= self._flush_interval or event:
            self.flush()
            self._last_flush = now
        # Once cancellation is seen, raise on EVERY call — fimcore's per-AOI
        # try/except catches the first raise and keeps logging.
        if self._cancel_latched:
            raise JobCancelled()
        if now - self._last_cancel_check >= self._cancel_interval:
            self._last_cancel_check = now
            if self._cancel_requested():
                self._cancel_latched = True
                raise JobCancelled()
        if self._deadline is not None and now >= self._deadline:
            raise JobTimeout()

    def _cancel_requested(self) -> bool:
        self._session.expire(self._run, ["status"])
        return self._run.status == "cancelled"

    def flush(self):
        self._run.progress = list(self._events)
        if self._log_lines:
            existing = self._run.log or ""
            self._run.log = (existing + "\n".join(self._log_lines) + "\n")[-100_000:]
            self._log_lines = []
        self._session.commit()


# ── Worker entry point ────────────────────────────────────────────────────────

def _ensure_django():
    """Dask workers run without DJANGO_SETTINGS_MODULE; django-storages reads
    django settings lazily, so configure a minimal stub once per worker."""
    import django
    from django.conf import settings

    if not settings.configured:
        settings.configure(USE_TZ=True, INSTALLED_APPS=[], DATABASES={})
        django.setup()


def _sanity_check_proj():
    """Fail loudly at job start rather than produce garbage rasters."""
    import os

    from tethysapp.fimsim_gui.geo_env import ensure_proj_data
    ensure_proj_data()
    from pyproj import Transformer
    x, y = Transformer.from_crs(26917, 4326, always_xy=True).transform(762300, 3909100)
    if not (-180 <= x <= 180 and -90 <= y <= 90):
        raise RuntimeError(
            f"pyproj transform returned ({x}, {y}) — PROJ data is broken on this "
            f"worker (PROJ_DATA={os.environ.get('PROJ_DATA')!r}). Align the "
            f"env's PROJ database with the pyproj build before running jobs."
        )


def _write_aoi_geojson(aoi, dest: Path) -> Path:
    from geoalchemy2.shape import to_shape
    from shapely.geometry import mapping

    geom = to_shape(aoi.geometry)
    fc = {
        "type": "FeatureCollection",
        "crs": {"type": "name", "properties": {"name": "urn:ogc:def:crs:OGC:1.3:CRS84"}},
        "features": [{
            "type": "Feature",
            "properties": {"name": aoi.name},
            "geometry": mapping(geom),
        }],
    }
    dest.write_text(json.dumps(fc))
    return dest


def _skip_workspace_dir(name: str) -> bool:
    """Tile caches are cheap to refetch and huge to store: skip the windowed
    cache (dem_tiles) AND the full-tile fallback dirs (DEM_raw_<aoi>, ~1GB)."""
    return name == "dem_tiles" or name.startswith("DEM_raw")


def _restore_workspace(storage, ws_prefix: str, ctx: dict, log_fn):
    """Download the AOI's persisted fimcore folder into this job's scratch and
    remap the per-AOI ctx's absolute paths (they were written by a previous
    job in a different scratch dir)."""
    folder = Path(ctx["aoi_features"][0]["folder_path"])
    entries = storage.list_prefix_with_sizes(ws_prefix)
    for key, _size in entries:
        rel = key[len(ws_prefix) + 1:]
        storage.download_to_path(key, folder / rel)
    if not entries:
        return
    feat_ctx_path = folder / "workflow_context.json"
    if feat_ctx_path.exists():
        raw = feat_ctx_path.read_text()
        try:
            old_root = json.loads(raw).get("project_dir")
        except json.JSONDecodeError:
            old_root = None
        if old_root and old_root != str(folder):
            raw = raw.replace(old_root, str(folder))
            old_parent = str(Path(old_root).parent)
            raw = raw.replace(old_parent, str(folder.parent))
            feat_ctx_path.write_text(raw)
    log_fn(f"workspace restored: {len(entries)} file(s)")


def _persist_workspace(storage, ws_prefix: str, ctx: dict):
    """Upload the AOI folder (minus caches) so later steps can restore it."""
    folder = Path(ctx["aoi_features"][0]["folder_path"])
    for p in sorted(folder.rglob("*")):
        if not p.is_file():
            continue
        rel = p.relative_to(folder)
        if rel.parts and _skip_workspace_dir(rel.parts[0]):
            continue
        key = f"{ws_prefix}/{rel.as_posix()}"
        with open(p, "rb") as fh:
            storage.save(key, fh)


def run_step_job(db_url: str, storage_config: dict, steprun_id: int,
                 timeout_s: int = DEFAULT_TIMEOUT_S) -> dict:
    """Executed on the Dask worker. Owns the StepRun lifecycle end to end."""
    from sqlalchemy import create_engine
    from sqlalchemy.orm import joinedload, sessionmaker

    from tethysapp.fimsim_gui.job_types import REGISTRY
    from tethysapp.fimsim_gui.models import StepRun
    from tethysapp.fimsim_gui.storage import build_key, service_from_config

    _ensure_django()
    _sanity_check_proj()

    engine = create_engine(db_url)
    session = sessionmaker(bind=engine)()
    scratch = None
    try:
        from tethysapp.fimsim_gui.models import Aoi
        run = (session.query(StepRun)
               .options(joinedload(StepRun.aoi).joinedload(Aoi.project))
               .get(steprun_id))
        if run is None:
            return {"status": "missing", "steprun_id": steprun_id}
        if run.status == "cancelled":
            return {"status": "cancelled", "steprun_id": steprun_id}

        run.status = "running"
        run.started = datetime.now(timezone.utc)
        session.commit()

        adapter = LogAdapter(session, run,
                             deadline=time.monotonic() + timeout_s)
        scratch = Path(tempfile.mkdtemp(prefix=f"fimsim-job-{steprun_id}-"))
        aoi_file = _write_aoi_geojson(run.aoi, scratch / "aoi.geojson")
        storage = service_from_config(storage_config)

        job_type = REGISTRY[run.step_key]
        ctx_path, ctx = job_type.prepare(scratch, aoi_file, adapter)

        # Restore this AOI's persisted workspace (earlier steps' artifacts +
        # per-AOI ctx) and remap its absolute paths into this job's scratch.
        project = run.aoi.project
        ws_prefix = build_key(project.username, project.id, run.aoi.id, "workspace")
        _restore_workspace(storage, ws_prefix, ctx, adapter)
        try:
            job_type.prestage_shared_cache(storage, ctx, adapter)
        except Exception as exc:  # a cache problem must never fail a job
            adapter(f"cache prestage skipped: {exc}")

        job_type.execute(ctx_path, ctx, run.config or {}, adapter)

        try:
            job_type.poststage_shared_cache(storage, ctx, adapter)
        except Exception as exc:
            adapter(f"cache poststage skipped: {exc}")

        # fimcore orchestrators log ✗ and continue instead of raising; a
        # "normal" return is NOT success.
        if adapter._cancel_latched:
            raise JobCancelled()
        if adapter.failure_messages:
            tail = (run.log or "")[-1500:]
            raise RuntimeError(
                "step reported failure: "
                + adapter.failure_messages[-1]
                + ("\n--- log tail ---\n" + tail if tail else ""))

        run.status = "uploading"
        adapter.flush()
        _persist_workspace(storage, ws_prefix, ctx)
        outputs_dir = job_type.collect(ctx, scratch)
        manifest = storage.store_outputs(run, outputs_dir)

        run.status = "succeeded"
        run.finished = datetime.now(timezone.utc)
        adapter.flush()
        return {"status": "succeeded", "steprun_id": steprun_id,
                "outputs": len(manifest)}

    except JobCancelled:
        _finalize(session, steprun_id, "cancelled", None)
        return {"status": "cancelled", "steprun_id": steprun_id}
    except JobTimeout:
        _finalize(session, steprun_id, "failed",
                  f"Job exceeded its {timeout_s}s time limit and was stopped.")
        return {"status": "failed", "steprun_id": steprun_id, "error": "timeout"}
    except Exception as exc:
        tb_tail = traceback.format_exc()[-4000:]
        _finalize(session, steprun_id, "failed",
                  f"{type(exc).__name__}: {exc}\n{tb_tail}")
        return {"status": "failed", "steprun_id": steprun_id, "error": str(exc)}
    finally:
        if scratch is not None:
            shutil.rmtree(scratch, ignore_errors=True)
        session.close()
        engine.dispose()


def _finalize(session, steprun_id, status, error):
    from tethysapp.fimsim_gui.models import StepRun

    session.rollback()
    run = session.query(StepRun).get(steprun_id)
    if run is not None:
        run.status = status
        if error:
            run.error = error
        run.finished = datetime.now(timezone.utc)
        session.commit()


# ── Submit side (web process) ─────────────────────────────────────────────────

def submit_step(step_run, user, *, timeout_s: int = DEFAULT_TIMEOUT_S):
    """Create + execute a Tethys DaskJob for one StepRun. Returns the DaskJob.

    Caller (BE7 endpoint / the dev harness) creates the StepRun row(s) first —
    one per AOI — and calls this per row.
    """
    from dask import delayed
    from tethys_sdk.jobs import DaskJob

    from tethysapp.fimsim_gui.app import App
    from tethysapp.fimsim_gui.storage import storage_config_from_settings

    scheduler = App.get_scheduler("dask_primary")
    # str(url) masks the password under SQLAlchemy 1.4 — render it fully,
    # the worker needs real credentials.
    db_url = App.get_persistent_store_database(
        "primary_db").url.render_as_string(hide_password=False)
    storage_config = storage_config_from_settings()

    job_manager = App.get_job_manager()
    job = job_manager.create_job(
        name=f"fimsim_{step_run.step_key}_{step_run.id}",
        user=user,
        job_type=DaskJob,
        scheduler=scheduler,
    )
    job.extended_properties = {
        "steprun_id": step_run.id,
        "aoi_id": step_run.aoi_id,
        "step_key": step_run.step_key,
    }
    job.save()
    job.execute(delayed(run_step_job)(db_url, storage_config, step_run.id, timeout_s))
    step_run.status = "queued"
    step_run.job_id = str(job.id)
    return job


# ── AOI context lookup (BE6): river + gages, network-bound → background job ──

def run_aoi_lookup(db_url: str, aoi_id: int) -> dict:
    """Executed on the Dask worker: NHD main-river + flowlines + USGS gages
    for one AOI. States/HUCs were resolved synchronously at ingest (PostGIS);
    this job carries only the network-bound lookups."""
    import shutil as _shutil
    import tempfile as _tempfile

    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    from tethysapp.fimsim_gui.models import Aoi

    _ensure_django()
    _sanity_check_proj()

    engine = create_engine(db_url)
    session = sessionmaker(bind=engine)()
    scratch = None
    try:
        aoi = session.query(Aoi).get(aoi_id)
        if aoi is None:
            return {"status": "missing", "aoi_id": aoi_id}
        aoi.lookup_status = "running"
        session.commit()

        scratch = Path(_tempfile.mkdtemp(prefix=f"fimsim-lookup-{aoi_id}-"))
        aoi_file = str(_write_aoi_geojson(aoi, scratch / "aoi.geojson"))

        from fimcore.aoi_info import (
            lookup_nhd_flowlines_clipped, lookup_usgs_gages,
        )
        from fimcore.river_lookup import lookup_main_river

        log = lambda *_: None  # noqa: E731 — lookups are chatty, results matter
        river_name = lookup_main_river(aoi_file, 0, log_fn=log)
        gages = lookup_usgs_gages(aoi_file, 0, log_fn=log)
        flowlines_gdf, main_river_gdf = lookup_nhd_flowlines_clipped(
            aoi_file, 0, log_fn=log)

        def _as_geojson(gdf, tolerance=0.0002):
            if gdf is None or len(gdf) == 0:
                return None
            g = gdf.to_crs(4326) if gdf.crs and gdf.crs.to_epsg() != 4326 else gdf
            g = g.assign(geometry=g.geometry.simplify(tolerance))
            return json.loads(g[["geometry"]].to_json())

        aoi.river_name = river_name
        aoi.lookup = {
            "gages": gages or [],
            "flowlines": _as_geojson(flowlines_gdf),
            "main_river": _as_geojson(main_river_gdf, tolerance=0.0001),
        }
        aoi.lookup_status = "done"
        aoi.lookup_error = None
        session.commit()
        return {"status": "done", "aoi_id": aoi_id,
                "river": river_name, "gages": len(gages or [])}
    except Exception as exc:
        session.rollback()
        aoi = session.query(Aoi).get(aoi_id)
        if aoi is not None:
            aoi.lookup_status = "failed"
            aoi.lookup_error = f"{type(exc).__name__}: {exc}"
            session.commit()
        return {"status": "failed", "aoi_id": aoi_id, "error": str(exc)}
    finally:
        if scratch is not None:
            _shutil.rmtree(scratch, ignore_errors=True)
        session.close()
        engine.dispose()


def submit_aoi_lookup(aoi, user):
    """Create + execute a Tethys DaskJob for one AOI's context lookup."""
    from dask import delayed
    from tethys_sdk.jobs import DaskJob

    from tethysapp.fimsim_gui.app import App

    scheduler = App.get_scheduler("dask_primary")
    db_url = App.get_persistent_store_database(
        "primary_db").url.render_as_string(hide_password=False)

    job_manager = App.get_job_manager()
    job = job_manager.create_job(
        name=f"fimsim_lookup_{aoi.id}",
        user=user,
        job_type=DaskJob,
        scheduler=scheduler,
    )
    job.extended_properties = {"aoi_id": aoi.id, "kind": "aoi_lookup"}
    job.save()
    job.execute(delayed(run_aoi_lookup)(db_url, aoi.id))
    aoi.lookup_status = "pending"
    return job


# ── BE7 submit-side helpers (pure, unit-testable) ────────────────────────────

def prerequisites_missing(aoi, step_key) -> list:
    """Prerequisite steps whose latest run has NOT succeeded."""
    from tethysapp.fimsim_gui.job_types import REGISTRY

    missing = []
    for req in REGISTRY[step_key].requires:
        current = aoi.current_step_run(req)
        if current is None or current.status != "succeeded":
            missing.append(req)
    return missing


def supersede_step_and_downstream(aoi, step_key) -> int:
    """Re-run semantics: a resubmit supersedes this step's runs AND every
    downstream step's (their inputs just changed). Returns count superseded."""
    from tethysapp.fimsim_gui.models import STEP_KEYS

    invalidated = STEP_KEYS[STEP_KEYS.index(step_key):]
    n = 0
    for run in aoi.step_runs:
        if run.step_key in invalidated and not run.superseded:
            run.superseded = True
            n += 1
    return n
