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


def _create_aois(session, request, project, ingest_result, source, source_key=None):
    """Persist ingested features as AOI rows + resolve states/HUCs (PostGIS,
    sync) + submit the network lookup job per AOI."""
    from tethysapp.fimsim_gui.jobs import submit_aoi_lookup

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

    created = _create_aois(session, request, project, result, source, source_key)
    return JsonResponse({
        'aois': [a.to_dict() for a in created],
        'skipped_non_polygon': result.skipped_non_polygon,
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
