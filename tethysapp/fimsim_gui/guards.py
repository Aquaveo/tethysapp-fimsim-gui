"""FIMSIM-BE10: resource guards — pure logic, wired into submit by controllers.

Every guard returns a user-facing reason string (or None): the submit
endpoint reports rejections per AOI, never silently skips. Cap values are
app settings; the welcome modal reads the same numbers via api/limits/.
"""
from datetime import datetime, timedelta, timezone

# Defaults (overridable via app settings)
DEFAULT_MAX_DEM_CELLS = 150_000_000          # ~600 MB float32 grid
DEFAULT_MAX_CONCURRENT_JOBS = 4              # active runs per user
DEFAULT_STORAGE_QUOTA_GB = 5.0
DEFAULT_RETENTION_DAYS = 30
# BE8 characterization: Neuse 36,582 cells × 4 sim-days ran in 10.6 s
# (~7e-5 s per cell-day); 4x safety margin for slower solvers/settings.
RUNTIME_S_PER_CELL_DAY = 3e-4
ACTIVE_STATUSES = ("pending", "queued", "running", "uploading")


def predicted_dem_cells(aoi, res_m: float) -> int:
    """Grid size of the AOI's bbox in its working CRS at res_m."""
    from geoalchemy2.shape import to_shape
    from pyproj import Transformer

    from tethysapp.fimsim_gui.geo_env import ensure_proj_data
    ensure_proj_data()

    geom = to_shape(aoi.geometry)
    minx, miny, maxx, maxy = geom.bounds
    epsg = aoi.working_crs_epsg or 5070
    t = Transformer.from_crs(4326, epsg, always_xy=True)
    xs, ys = zip(t.transform(minx, miny), t.transform(maxx, miny),
                 t.transform(maxx, maxy), t.transform(minx, maxy))
    dx, dy = max(xs) - min(xs), max(ys) - min(ys)
    res = max(float(res_m), 0.1)
    return int(dx / res) * int(dy / res)


def check_dem_submit(aoi, config: dict, max_cells: int):
    res_m = float(config.get("dem_res_m") or 30)
    cells = predicted_dem_cells(aoi, res_m)
    if cells > max_cells:
        return (
            f"'{aoi.name}' at {res_m:g} m would be a {cells / 1e6:,.0f}-megacell "
            f"grid — the limit is {max_cells / 1e6:,.0f} megacells. Choose a "
            f"coarser resolution or a smaller area (large case studies are "
            f"better served by the desktop FIMsim)."
        )
    return None


def check_run_submit(aoi, config: dict, timeout_s: float):
    """Best-effort runtime estimate from the DEM grid + PAR sim_time."""
    dem = aoi.current_step_run("dem")
    par = aoi.current_step_run("par")
    if not dem or not par:
        return None  # dependency guard handles missing steps
    try:
        res_m = float((dem.config or {}).get("dem_res_m") or 30)
        sim_time = float((par.config or {}).get("sim_time") or 0)
        if not sim_time:
            return None
        cells = predicted_dem_cells(aoi, res_m)
        est_s = cells * (sim_time / 86400.0) * RUNTIME_S_PER_CELL_DAY
    except Exception:
        return None  # estimation must never block a valid run
    if est_s > float(timeout_s):
        return (
            f"'{aoi.name}' is estimated to need ~{est_s / 60:,.0f} min of solver "
            f"time — over the {timeout_s / 60:,.0f} min limit. Coarsen the DEM "
            f"resolution, shorten the event window, or raise the time limit."
        )
    return None


def active_runs_count(session, username: str) -> int:
    from tethysapp.fimsim_gui.models import Aoi, Project, StepRun
    return (session.query(StepRun)
            .join(Aoi, StepRun.aoi_id == Aoi.id)
            .join(Project, Aoi.project_id == Project.id)
            .filter(Project.username == username,
                    StepRun.status.in_(ACTIVE_STATUSES))
            .count())


def check_concurrency(session, username: str, wanted: int, max_jobs: int):
    active = active_runs_count(session, username)
    if active + wanted > max_jobs:
        return (
            f"You have {active} job(s) running and this would add {wanted} — "
            f"the limit is {max_jobs} concurrent jobs. Wait for the current "
            f"runs to finish (or cancel some)."
        )
    return None


def check_storage_quota(storage, username: str, quota_gb: float):
    used = storage.usage_bytes(username)
    if used > quota_gb * 1e9:
        return (
            f"Your storage is full: {used / 1e9:.2f} GB used of the "
            f"{quota_gb:g} GB quota. Delete old projects to free space."
        )
    return None


# ── maintenance (scripts/maintenance.py drives these on a schedule) ──────────

def stale_active_runs(session, older_than_s: float = 3 * 3600):
    """Active runs whose last sign of life is older than the threshold —
    the worker died before finalizing (OOM kill, reboot). Reap → failed."""
    from tethysapp.fimsim_gui.models import StepRun

    now = datetime.now(timezone.utc)
    stale = []
    for run in (session.query(StepRun)
                .filter(StepRun.status.in_(ACTIVE_STATUSES)).all()):
        last = None
        for e in reversed(run.progress or []):
            if e.get("at"):
                try:
                    last = datetime.fromisoformat(e["at"])
                    break
                except ValueError:
                    pass
        last = last or run.started or run.created
        if last is not None and last.tzinfo is None:
            last = last.replace(tzinfo=timezone.utc)
        if last is not None and (now - last).total_seconds() > older_than_s:
            stale.append(run)
    return stale


def reap_stale_runs(session, older_than_s: float = 3 * 3600) -> int:
    n = 0
    for run in stale_active_runs(session, older_than_s):
        run.status = "failed"
        run.error = (
            "No progress for over "
            f"{older_than_s / 3600:.0f}h — the worker likely died before "
            "finishing (reaped by maintenance). Re-run the step."
        )
        run.finished = datetime.now(timezone.utc)
        n += 1
    session.commit()
    return n


def expired_runs(session, retention_days: int):
    """Superseded or old finished runs whose artifacts can be deleted."""
    from tethysapp.fimsim_gui.models import StepRun

    cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days)
    out = []
    for run in session.query(StepRun).filter(StepRun.manifest.isnot(None)).all():
        finished = run.finished
        if finished is not None and finished.tzinfo is None:
            finished = finished.replace(tzinfo=timezone.utc)
        if run.superseded or (finished is not None and finished < cutoff):
            out.append(run)
    return out


def clean_expired_artifacts(session, storage, retention_days: int) -> int:
    """Delete expired runs' stored files; mark their manifests expired.
    Idempotent — a manifest already marked expired is skipped."""
    n_bytes = 0
    for run in expired_runs(session, retention_days):
        manifest = run.manifest or []
        if not manifest or (isinstance(manifest, dict) and manifest.get("expired")):
            continue
        for m in manifest:
            try:
                storage.delete(m["key"])
                n_bytes += int(m.get("bytes") or 0)
            except Exception:
                pass  # missing object = already gone
        run.manifest = {"expired": True, "was": [m["name"] for m in manifest]}
    session.commit()
    return n_bytes


def evict_shared_cache(storage, max_age_days: int = 90,
                       max_total_gb: float = 20.0) -> int:
    """Age- then size-based eviction of the cross-user cache. Returns bytes
    freed. Oldest-modified go first once the size cap is exceeded."""
    from tethysapp.fimsim_gui.storage import SHARED_CACHE_PREFIX

    entries = []
    for key, size in storage.list_prefix_with_sizes(SHARED_CACHE_PREFIX):
        mtime = storage.modified_time(key)
        entries.append((key, size, mtime))

    now = datetime.now(timezone.utc)
    freed = 0
    kept = []
    for key, size, mtime in entries:
        age_ok = mtime is None or (
            (now - (mtime if mtime.tzinfo else mtime.replace(tzinfo=timezone.utc)))
            .total_seconds() <= max_age_days * 86400)
        if not age_ok:
            storage.delete(key)
            freed += size
        else:
            kept.append((key, size, mtime))

    total = sum(s for _, s, _ in kept)
    cap = max_total_gb * 1e9
    if total > cap:
        kept.sort(key=lambda e: e[2] or datetime.min.replace(tzinfo=timezone.utc))
        for key, size, _ in kept:
            if total <= cap:
                break
            storage.delete(key)
            freed += size
            total -= size
    return freed
