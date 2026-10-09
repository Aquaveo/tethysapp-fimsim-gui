"""FIMSIM-BE3 model tests.

DB tests run against a scratch database on the local portal PostgreSQL
(PostGIS needed for the geometry columns) and are skipped when it's
unreachable. The _PER_AOI_KEYS coverage check needs only the fimcore source.
"""
import ast
from pathlib import Path

import pytest

from tethysapp.fimsim_gui.models import (
    Aoi, Base, PER_AOI_KEY_HOMES, Project, StepRun, sanitize_name,
)

NEUSE_WKT = (
    "SRID=4326;POLYGON((-78.10992 35.45282,-77.93055 35.44839,"
    "-77.93668 35.28632,-78.1157 35.29072,-78.10992 35.45282))"
)


# ── sanitize_name: fimcore.project.clean_name parity ─────────────────────────

def test_sanitize_name_parity_cases():
    assert sanitize_name('  My <Project>: "v2"  ') == "My_Project_v2"
    assert sanitize_name("a//b\\c") == "a_b_c"
    assert sanitize_name("_.trimmed._") == "trimmed"


# ── client-facing config projection hides server-only keys (Copilot review) ───

def test_run_config_projection_hides_solver_path():
    # `run` stores solver_path in config at submit; every project-status poll
    # and steprun read projects config back to the client — the worker's binary
    # path must not leak. Server-only keys are stripped from both projections.
    from datetime import datetime, timezone
    run = StepRun(
        step_key="run",
        config={"solver_path": "/opt/lisflood/bin/lisflood",
                "solver_timeout_s": 3600, "keep_snapshots": False},
        created=datetime(2024, 1, 1, tzinfo=timezone.utc),
    )
    for projection in (run.to_summary_dict(), run.to_dict()):
        assert "solver_path" not in projection["config"]
        # FE50/BE20: the budget is server-side now, so it is hidden too
        assert "solver_timeout_s" not in projection["config"]
        assert projection["config"]["keep_snapshots"] is False  # non-secret kept


# ── _PER_AOI_KEYS coverage: schema must account for every desktop ctx key ────

def _fimcore_per_aoi_keys():
    for candidate in (
        Path.home() / "tethysdev" / "fimcore" / "src" / "fimcore" / "triton_orchestrate.py",
    ):
        if candidate.exists():
            tree = ast.parse(candidate.read_text())
            for node in ast.walk(tree):
                if (isinstance(node, ast.Assign)
                        and any(getattr(t, "id", None) == "_PER_AOI_KEYS" for t in node.targets)):
                    return set(ast.literal_eval(node.value))
    try:
        from fimcore.triton_orchestrate import _PER_AOI_KEYS
        return set(_PER_AOI_KEYS)
    except ImportError:
        return None


def test_per_aoi_keys_fully_mapped():
    keys = _fimcore_per_aoi_keys()
    if keys is None:
        pytest.skip("fimcore source not available")
    mapped = set(PER_AOI_KEY_HOMES)
    assert keys - mapped == set(), f"desktop ctx keys with no schema home: {keys - mapped}"
    assert mapped - keys == set(), f"stale mappings for removed ctx keys: {mapped - keys}"


# ── DB behavior (scratch PostGIS database) ────────────────────────────────────

@pytest.fixture(scope="module")
def engine():
    import yaml
    from sqlalchemy import create_engine, text

    cfg = Path.home() / ".tethys" / "portal_config.yml"
    if not cfg.exists():
        pytest.skip("no local portal config")
    db = yaml.safe_load(cfg.read_text())["settings"]["DATABASES"]["default"]
    admin_url = (f"postgresql://{db['USER']}:{db['PASSWORD']}@"
                 f"{db['HOST']}:{db['PORT']}")
    try:
        admin = create_engine(admin_url + "/postgres",
                              isolation_level="AUTOCOMMIT")
        with admin.connect() as conn:
            conn.execute(text("DROP DATABASE IF EXISTS fimsim_gui_test"))
            conn.execute(text("CREATE DATABASE fimsim_gui_test"))
    except Exception as exc:
        pytest.skip(f"portal PostgreSQL unreachable: {exc}")

    eng = create_engine(admin_url + "/fimsim_gui_test")
    with eng.connect() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS postgis"))
        conn.commit() if hasattr(conn, "commit") else None
    Base.metadata.create_all(eng)
    yield eng
    eng.dispose()
    with admin.connect() as conn:
        conn.execute(text(
            "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
            "WHERE datname='fimsim_gui_test'"))
        conn.execute(text("DROP DATABASE fimsim_gui_test"))


@pytest.fixture()
def session(engine):
    from sqlalchemy.orm import sessionmaker
    s = sessionmaker(bind=engine)()
    yield s
    s.rollback()
    for table in ("step_runs", "aois", "projects"):
        s.execute(__import__("sqlalchemy").text(f"DELETE FROM {table}"))
    s.commit()
    s.close()


def _mk_project(session, username="reshma", name="Neuse_Test"):
    p = Project(username=username, name=sanitize_name(name))
    session.add(p)
    session.commit()
    return p


def test_project_unique_per_user(session):
    from sqlalchemy.exc import IntegrityError
    _mk_project(session)
    _mk_project(session, username="someone_else")  # same name, other user: fine
    with pytest.raises(IntegrityError):
        _mk_project(session)  # duplicate for same user
    session.rollback()


def test_aoi_and_steprun_lifecycle(session):
    p = _mk_project(session)
    a = Aoi(project_id=p.id, name="Neuse", source="example",
            geometry=NEUSE_WKT, area_km2=290.4, is_rectangular=True,
            working_crs_epsg=26917)
    session.add(a)
    session.commit()

    r1 = StepRun(aoi_id=a.id, step_key="dem", status="succeeded",
                 config={"dem_res_m": 90, "dem_source": "3dep"},
                 manifest=[{"key": "u/1/1/dem/DEM_AOI_1.tif", "bytes": 123}])
    session.add(r1)
    session.commit()

    assert a.current_step_run("dem").id == r1.id
    assert a.current_step_run("manning") is None

    # re-run semantics: superseded runs stop being "current"
    r1.superseded = True
    r2 = StepRun(aoi_id=a.id, step_key="dem", status="running",
                 config={"dem_res_m": 30, "dem_source": "3dep"})
    session.add(r2)
    session.commit()
    assert a.current_step_run("dem").id == r2.id

    d = a.to_dict()
    assert d["steps"]["dem"]["status"] == "running"
    assert d["working_crs_epsg"] == 26917


def test_cascade_delete(session):
    from sqlalchemy import text
    p = _mk_project(session, name="Doomed")
    a = Aoi(project_id=p.id, name="x", source="drawn", geometry=NEUSE_WKT)
    session.add(a)
    session.commit()
    session.add(StepRun(aoi_id=a.id, step_key="dem"))
    session.commit()

    session.delete(p)
    session.commit()
    assert session.execute(text("SELECT count(*) FROM aois")).scalar() == 0
    assert session.execute(text("SELECT count(*) FROM step_runs")).scalar() == 0


# ── FIMSIM-FE48: the model is a property of the project ──────────────────────

def test_normalize_model_accepts_known_models_and_defaults_blank():
    from tethysapp.fimsim_gui.models import DEFAULT_MODEL, normalize_model
    assert normalize_model("triton") == "triton"
    assert normalize_model("lisflood-fp") == "lisflood-fp"
    assert normalize_model(None) == DEFAULT_MODEL
    assert normalize_model("") == DEFAULT_MODEL
    assert normalize_model("hec-ras") is None   # caller turns None into a 400


def test_project_model_defaults_to_lisflood_and_is_serialized(session):
    p = _mk_project(session)
    assert p.to_dict()["model"] == "lisflood-fp"
    t = Project(username="reshma", name="Deck", model="triton")
    session.add(t)
    session.commit()
    assert t.to_dict()["model"] == "triton"


def _legacy_projects_table(engine):
    """Drop the model column so the table looks like a pre-FE48 portal DB."""
    from sqlalchemy import text
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE projects DROP COLUMN IF EXISTS model"))


def test_ensure_project_model_column_adds_and_backfills_from_step_runs(engine, session):
    from sqlalchemy import text
    from tethysapp.fimsim_gui.models import ensure_project_model_column
    _legacy_projects_table(engine)
    with engine.begin() as conn:
        conn.execute(text(
            "INSERT INTO projects (id, username, name, created) VALUES "
            "(901, 'r', 'LegacyLisflood', now()), (902, 'r', 'LegacyTriton', now())"))
        conn.execute(text(
            "INSERT INTO aois (id, project_id, name, source, geometry, lookup_status) VALUES "
            f"(801, 901, 'a', 'drawn', ST_GeomFromEWKT('{NEUSE_WKT}'), 'done'), "
            f"(802, 902, 'b', 'drawn', ST_GeomFromEWKT('{NEUSE_WKT}'), 'done')"))
        conn.execute(text(
            "INSERT INTO step_runs (aoi_id, step_key, status, superseded, config, created) VALUES "
            "(801, 'dem', 'succeeded', false, '{}', now()), "
            "(802, 'tbc', 'succeeded', false, '{}', now())"))

    added = ensure_project_model_column(engine)
    assert added is True
    models = dict(session.execute(text("SELECT id, model FROM projects")).all())
    assert models == {901: "lisflood-fp", 902: "triton"}


def test_ensure_project_model_column_is_idempotent_and_keeps_explicit_choices(engine, session):
    from sqlalchemy import text
    from tethysapp.fimsim_gui.models import ensure_project_model_column
    _legacy_projects_table(engine)
    assert ensure_project_model_column(engine) is True
    # a project the user explicitly made LISFLOOD that happens to carry an
    # old TRITON run must NOT be flipped by a later re-run of the sync
    with engine.begin() as conn:
        conn.execute(text(
            "INSERT INTO projects (id, username, name, created, model) VALUES "
            "(903, 'r', 'Chosen', now(), 'lisflood-fp')"))
        conn.execute(text(
            "INSERT INTO aois (id, project_id, name, source, geometry, lookup_status) VALUES "
            f"(803, 903, 'c', 'drawn', ST_GeomFromEWKT('{NEUSE_WKT}'), 'done')"))
        conn.execute(text(
            "INSERT INTO step_runs (aoi_id, step_key, status, superseded, config, created) VALUES "
            "(803, 'tdem', 'succeeded', false, '{}', now())"))
    assert ensure_project_model_column(engine) is False
    model = session.execute(text("SELECT model FROM projects WHERE id=903")).scalar()
    assert model == "lisflood-fp"
