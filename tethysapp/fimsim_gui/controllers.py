"""FIMsim GUI controllers: the SPA catch-all + the BE6 REST layer.

Family idiom (FIMeval): login-required JSON controllers, ownership checked on
every object access. AOI uploads use direct multipart POST rather than the
presign flow — AOI files are boundaries (KBs–MBs, 30 MB cap), so one round
trip through Django is simpler and lets validation happen before anything
touches storage; the presign path (BE4) stays for genuinely large uploads
(user DEMs, BE7).
"""
import json
import logging
import tempfile
from functools import wraps
from pathlib import Path

from django.http import JsonResponse
from django.views.decorators.csrf import ensure_csrf_cookie
from geoalchemy2.shape import from_shape
from shapely.geometry import shape
from tethys_sdk.routing import controller

from tethysapp.fimsim_gui.app import App
from tethysapp.fimsim_gui.ingest import IngestError, ingest_aoi_file, ingest_geojson_geometry
from tethysapp.fimsim_gui.models import Aoi, Project, get_session_maker, sanitize_name
from tethysapp.fimsim_gui.services import resolve_aoi_context

logger = logging.getLogger(__name__)


@controller(login_required=False)
def home(request):
    """App home page (SPA catch-all): serves the built React bundle."""
    return App.render(request, 'index.html')


@controller(url='api/csrf', login_required=False, name='api_csrf')
@ensure_csrf_cookie
def api_csrf(request):
    return JsonResponse({'ok': True})


# ── plumbing ──────────────────────────────────────────────────────────────────

def with_session(fn):
    """Open a DB session for the request; always close it."""
    @wraps(fn)
    def wrapper(request, *args, **kwargs):
        session = get_session_maker(App)()
        try:
            return fn(request, session, *args, **kwargs)
        finally:
            session.close()
    return wrapper


def _owned_project(session, request, project_id):
    project = session.query(Project).get(int(project_id))
    if project is None:
        return None, JsonResponse({'error': 'project not found'}, status=404)
    if project.username != request.user.username:
        return None, JsonResponse({'error': 'access denied'}, status=403)
    return project, None


def _owned_aoi(session, request, aoi_id):
    aoi = session.query(Aoi).get(int(aoi_id))
    if aoi is None:
        return None, JsonResponse({'error': 'AOI not found'}, status=404)
    if aoi.project.username != request.user.username:
        return None, JsonResponse({'error': 'access denied'}, status=403)
    return aoi, None


DEFAULT_MAX_AOI_AREA_KM2 = 1000.0  # Parvaneh's proposal; group decision pending


def _setting(name, default):
    try:
        v = App.get_custom_setting(name)
        return type(default)(v) if v else default
    except Exception:
        return default


def max_aoi_area_km2() -> float:
    return _setting('max_aoi_area_km2', DEFAULT_MAX_AOI_AREA_KM2)


def _create_aois(session, request, project, ingest_result, source, source_key=None):
    """Persist ingested features as AOI rows + resolve states/HUCs (PostGIS,
    sync) + submit the network lookup job per AOI."""
    from tethysapp.fimsim_gui.jobs import submit_aoi_lookup

    cap = max_aoi_area_km2()
    too_big = [f for f in ingest_result.features if f.area_km2 > cap]
    if too_big:
        worst = max(f.area_km2 for f in too_big)
        raise IngestError(
            f"Area too large: {worst:,.0f} km² exceeds the {cap:,.0f} km² limit "
            f"({len(too_big)} feature(s)). Large-scale case studies are better "
            f"served by the desktop FIMsim — or split the area into smaller pieces."
        )

    created = []
    for feat in ingest_result.features:
        ctx = resolve_aoi_context(feat.geometry_geojson)
        aoi = Aoi(
            project_id=project.id,
            name=feat.name,
            source=source,
            source_key=source_key,
            geometry=from_shape(shape(feat.geometry_geojson), srid=4326),
            area_km2=feat.area_km2,
            is_rectangular=feat.is_rectangular,
            working_crs_epsg=feat.working_crs_epsg,
            states=ctx['states'],
            huc6_codes=ctx['huc6_codes'],
            huc8_codes=ctx['huc8_codes'],
        )
        session.add(aoi)
        session.flush()
        created.append(aoi)

    for aoi in created:
        try:
            submit_aoi_lookup(aoi, request.user)
        except Exception as exc:  # scheduler down ≠ ingest failure
            logger.warning('lookup submission failed for AOI %s: %s', aoi.id, exc)
            aoi.lookup_status = 'failed'
            aoi.lookup_error = f'lookup could not be submitted: {exc}'
    session.commit()
    return created


# ── projects ──────────────────────────────────────────────────────────────────

@controller(url='api/projects', name='api_projects')
@with_session
def api_projects(request, session):
    if request.method == 'POST':
        try:
            body = json.loads(request.body or '{}')
        except json.JSONDecodeError:
            return JsonResponse({'error': 'invalid JSON'}, status=400)
        name = sanitize_name(str(body.get('name', '')))
        if not name:
            return JsonResponse(
                {'error': 'Project name is required (letters, numbers, spaces).'},
                status=400)
        exists = (session.query(Project)
                  .filter_by(username=request.user.username, name=name).first())
        if exists:
            return JsonResponse(
                {'error': f'You already have a project named "{name}".'}, status=409)
        project = Project(username=request.user.username, name=name)
        session.add(project)
        session.commit()
        return JsonResponse(project.to_dict(), status=201)

    projects = (session.query(Project)
                .filter_by(username=request.user.username)
                .order_by(Project.created.desc()).all())
    return JsonResponse({'projects': [p.to_dict() for p in projects]})


@controller(url='api/projects/{project_id}', name='api_project')
@with_session
def api_project(request, session, project_id):
    project, err = _owned_project(session, request, project_id)
    if err:
        return err
    if request.method == 'DELETE':
        session.delete(project)
        session.commit()
        return JsonResponse({'deleted': True})
    return JsonResponse(project.to_dict(with_aois=True))


# ── AOIs ──────────────────────────────────────────────────────────────────────

@controller(url='api/projects/{project_id}/aois', name='api_project_aois')
@with_session
def api_project_aois(request, session, project_id):
    project, err = _owned_project(session, request, project_id)
    if err:
        return err
    if request.method != 'POST':
        return JsonResponse({'aois': [a.to_dict() for a in project.aois]})

    try:
        if request.FILES.get('file'):
            up = request.FILES['file']
            with tempfile.NamedTemporaryFile(
                    suffix=Path(up.name).suffix, delete=False) as tmp:
                for chunk in up.chunks():
                    tmp.write(chunk)
                tmp_path = tmp.name
            try:
                result = ingest_aoi_file(tmp_path, up.name, up.size)
                source, source_key = 'upload', None
                # keep the original upload for provenance (ctx: aoi_path)
                from tethysapp.fimsim_gui.storage import build_key, get_storage
                source_key = build_key(request.user.username, project.id,
                                       filename=up.name)
                with open(tmp_path, 'rb') as fh:
                    get_storage().save(source_key, fh)
            finally:
                Path(tmp_path).unlink(missing_ok=True)
        else:
            body = json.loads(request.body or '{}')
            geometry = body.get('geometry')
            if not geometry:
                return JsonResponse(
                    {'error': 'Provide a file upload or a GeoJSON "geometry".'},
                    status=400)
            name = str(body.get('name') or f'Drawn AOI')
            result = ingest_geojson_geometry(geometry, name)
            source, source_key = str(body.get('source') or 'drawn'), None
    except IngestError as exc:
        return JsonResponse({'error': str(exc)}, status=400)
    except json.JSONDecodeError:
        return JsonResponse({'error': 'invalid JSON'}, status=400)

    try:
        created = _create_aois(session, request, project, result, source, source_key)
    except IngestError as exc:
        return JsonResponse({'error': str(exc)}, status=400)
    return JsonResponse({
        'aois': [a.to_dict() for a in created],
        'skipped_non_polygon': result.skipped_non_polygon,
        'warnings': result.warnings,
    }, status=201)


@controller(url='api/aois/{aoi_id}', name='api_aoi')
@with_session
def api_aoi(request, session, aoi_id):
    aoi, err = _owned_aoi(session, request, aoi_id)
    if err:
        return err
    if request.method == 'DELETE':
        session.delete(aoi)
        session.commit()
        return JsonResponse({'deleted': True})
    return JsonResponse(aoi.to_dict())


@controller(url='api/aois/{aoi_id}/lookup', name='api_aoi_lookup')
@with_session
def api_aoi_lookup(request, session, aoi_id):
    """Re-submit the network lookup (retry action for FE3's failed state)."""
    from tethysapp.fimsim_gui.jobs import submit_aoi_lookup

    aoi, err = _owned_aoi(session, request, aoi_id)
    if err:
        return err
    if request.method != 'POST':
        return JsonResponse({'error': 'POST required'}, status=405)
    try:
        submit_aoi_lookup(aoi, request.user)
        session.commit()
    except Exception as exc:
        return JsonResponse({'error': f'lookup submission failed: {exc}'}, status=503)
    return JsonResponse(aoi.to_dict(), status=202)


# ── FIMSIM-BE7: step submission, status, cancel ───────────────────────────────

def _owned_steprun(session, request, steprun_id):
    from tethysapp.fimsim_gui.models import StepRun
    run = session.query(StepRun).get(int(steprun_id))
    if run is None:
        return None, JsonResponse({'error': 'step run not found'}, status=404)
    if run.aoi.project.username != request.user.username:
        return None, JsonResponse({'error': 'access denied'}, status=403)
    return run, None


@controller(url='api/limits', name='api_limits')
def api_limits(request):
    """Usage limits, stated once server-side so UI copy can't drift."""
    from tethysapp.fimsim_gui import guards
    return JsonResponse({
        'max_aoi_area_km2': max_aoi_area_km2(),
        'dem_baseline_res_m': 10,
        'max_dem_cells': _setting('max_dem_cells', guards.DEFAULT_MAX_DEM_CELLS),
        'max_concurrent_jobs': _setting('max_concurrent_jobs',
                                        guards.DEFAULT_MAX_CONCURRENT_JOBS),
        'storage_quota_gb': _setting('storage_quota_gb',
                                     guards.DEFAULT_STORAGE_QUOTA_GB),
        'retention_days': _setting('retention_days', guards.DEFAULT_RETENTION_DAYS),
    })


@controller(url='api/steps', name='api_steps')
def api_steps(request):
    """Every step's defaults + prerequisites — the FE panels' schema source."""
    from tethysapp.fimsim_gui.job_types import REGISTRY
    return JsonResponse({
        key: {'defaults': jt.defaults(), 'requires': list(jt.requires)}
        for key, jt in REGISTRY.items()
    })


@controller(url='api/projects/{project_id}/steps/{step_key}/submit',
            name='api_step_submit')
@with_session
def api_step_submit(request, session, project_id, step_key):
    """Submit one wizard step for the project's AOIs — one DaskJob per AOI.

    Body: {"config": {...}, "aoi_ids": [..]?, "aoi_configs": {"<id>": {...}}?}
    AOIs failing the dependency guard are reported, never silently skipped.
    """
    from tethysapp.fimsim_gui.job_types import REGISTRY
    from tethysapp.fimsim_gui.jobs import (
        prerequisites_missing, submit_step, supersede_step_and_downstream,
    )
    from tethysapp.fimsim_gui.models import StepRun

    if request.method != 'POST':
        return JsonResponse({'error': 'POST required'}, status=405)
    if step_key not in REGISTRY:
        return JsonResponse({'error': f'unknown step "{step_key}"'}, status=404)
    project, err = _owned_project(session, request, project_id)
    if err:
        return err
    try:
        body = json.loads(request.body or '{}')
    except json.JSONDecodeError:
        return JsonResponse({'error': 'invalid JSON'}, status=400)

    base_config = body.get('config') or {}
    aoi_configs = body.get('aoi_configs') or {}
    if not isinstance(base_config, dict) or not isinstance(aoi_configs, dict):
        return JsonResponse({'error': 'config and aoi_configs must be objects'},
                            status=400)
    wanted = body.get('aoi_ids')
    aois = [a for a in project.aois if wanted is None or a.id in wanted]
    if not aois:
        return JsonResponse({'error': 'no AOIs to submit'}, status=400)

    from tethysapp.fimsim_gui import guards
    from tethysapp.fimsim_gui.storage import get_storage

    # project-wide guards: one clear rejection instead of per-AOI spam
    reason = guards.check_concurrency(
        session, request.user.username, len(aois),
        _setting('max_concurrent_jobs', guards.DEFAULT_MAX_CONCURRENT_JOBS))
    if reason is None:
        try:
            reason = guards.check_storage_quota(
                get_storage(), request.user.username,
                _setting('storage_quota_gb', guards.DEFAULT_STORAGE_QUOTA_GB))
        except Exception as exc:
            logger.warning('quota check skipped: %s', exc)
    if reason:
        return JsonResponse({'error': reason}, status=429)

    jt = REGISTRY[step_key]
    results = []
    for aoi in aois:
        missing = prerequisites_missing(aoi, step_key)
        if missing:
            results.append({
                'aoi_id': aoi.id, 'submitted': False,
                'reason': (f'requires the {", ".join(missing)} step(s) to have '
                           f'succeeded first'),
            })
            continue
        current = aoi.current_step_run(step_key)
        if current is not None and current.status in ('queued', 'running', 'uploading'):
            results.append({
                'aoi_id': aoi.id, 'submitted': False,
                'reason': 'this step is already running for this AOI',
            })
            continue
        merged_config = {**base_config, **(aoi_configs.get(str(aoi.id)) or {})}
        # per-AOI resource prechecks BEFORE anything is superseded or created
        guard_reason = None
        if step_key == 'dem':
            guard_reason = guards.check_dem_submit(
                aoi, jt.merged(merged_config),
                _setting('max_dem_cells', guards.DEFAULT_MAX_DEM_CELLS))
        elif step_key == 'run':
            timeout = float(jt.merged(merged_config).get('solver_timeout_s') or 3600)
            guard_reason = guards.check_run_submit(aoi, merged_config, timeout)
        if guard_reason:
            results.append({'aoi_id': aoi.id, 'submitted': False,
                            'reason': guard_reason})
            continue
        supersede_step_and_downstream(aoi, step_key)
        if step_key == 'run' and not merged_config.get('solver_path'):
            merged_config['solver_path'] = App.get_custom_setting('lisflood_binary_path')
        run = StepRun(aoi_id=aoi.id, step_key=step_key, config=merged_config)
        session.add(run)
        session.flush()
        try:
            submit_step(run, request.user)
            results.append({'aoi_id': aoi.id, 'submitted': True, 'steprun_id': run.id})
        except Exception as exc:
            logger.error('submit failed for AOI %s step %s: %s', aoi.id, step_key, exc)
            run.status = 'failed'
            run.error = f'submission failed: {exc}'
            results.append({'aoi_id': aoi.id, 'submitted': False,
                            'reason': f'submission failed: {exc}',
                            'steprun_id': run.id})
    session.commit()
    status = 202 if any(r['submitted'] for r in results) else 503
    return JsonResponse({'results': results}, status=status)


@controller(url='api/projects/{project_id}/status', name='api_project_status')
@with_session
def api_project_status(request, session, project_id):
    """The polling payload: every AOI with lookup + current step summaries."""
    project, err = _owned_project(session, request, project_id)
    if err:
        return err
    return JsonResponse({'aois': [a.to_dict() for a in project.aois]})


@controller(url='api/stepruns/{steprun_id}', name='api_steprun')
@with_session
def api_steprun(request, session, steprun_id):
    run, err = _owned_steprun(session, request, steprun_id)
    if err:
        return err
    return JsonResponse(run.to_dict())


@controller(url='api/stepruns/{steprun_id}/cancel', name='api_steprun_cancel')
@with_session
def api_steprun_cancel(request, session, steprun_id):
    run, err = _owned_steprun(session, request, steprun_id)
    if err:
        return err
    if request.method != 'POST':
        return JsonResponse({'error': 'POST required'}, status=405)
    if run.status not in ('pending', 'queued', 'running', 'uploading'):
        return JsonResponse({'error': f'cannot cancel a {run.status} run'}, status=409)
    run.status = 'cancelled'
    session.commit()
    return JsonResponse(run.to_dict(), status=202)


# ── FIMSIM-BE9 (minimal): outputs with presigned download URLs ────────────────

@controller(url='api/stepruns/{steprun_id}/outputs', name='api_steprun_outputs')
@with_session
def api_steprun_outputs(request, session, steprun_id):
    """The run's manifest, each entry with a short-lived presigned GET URL
    (browser pulls straight from MinIO/S3; local backend returns url: null)."""
    from tethysapp.fimsim_gui.storage import get_storage

    run, err = _owned_steprun(session, request, steprun_id)
    if err:
        return err
    storage = get_storage()
    outputs = []
    for m in (run.manifest or []):
        outputs.append({**m, 'url': storage.presigned_url(m['key'], 3600)})
    return JsonResponse({'steprun_id': run.id, 'outputs': outputs})


@controller(url='api/manning-table', name='api_manning_table')
def api_manning_table(request):
    """Per-class Manning's n reference tables (label, min, max, default) —
    served from fimcore so the UI can't drift from what rasterization uses."""
    from fimcore.nlcd import NLCD_MANNING, SENTINEL2_MANNING

    def rows(table):
        return {
            str(code): {'label': label, 'min': mn, 'max': mx, 'default': avg}
            for code, (label, mn, mx, avg) in table.items()
            if mn is not None
        }
    return JsonResponse({
        'esri': rows(SENTINEL2_MANNING),
        'nlcd': rows(NLCD_MANNING),
        'fallback_default': 0.045,
    })
