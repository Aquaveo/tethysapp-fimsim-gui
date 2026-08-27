"""FIMSIM-BE3: the persistent data model.

Replaces the desktop app's per-AOI ``workflow_context.json`` key-value bag with
real records on a Tethys spatial persistent store (SQLAlchemy — the
Tethys-native convention; the family has no prior custom DB to copy).

_PER_AOI_KEYS coverage (fimcore.triton_orchestrate) — where each desktop ctx
key lives now:

  aoi_path, aoi_feature_index      -> Aoi.source_key / Aoi.feature_index
  main_river_name, main_feature_name, upstream_reach_id, num_sources,
  upstream_x, upstream_y           -> Aoi.river_name / Aoi.lookup JSON
  dem_res_m, dem_source, dem_epsg  -> StepRun.config (dem step)
  dem_path, dem_tif_path, dem_ascii_path, flowlines_path,
  manning_ascii_path, manning_tif_path, lulc_path,
  triton_* artifact paths          -> StepRun.manifest (storage keys — paths
                                      are dead on a server; BE4's manifest is
                                      the replacement for every *_path key)
  lulc_source, triton_fric_mode, par_fpfric, triton_hydro_source,
  triton_hydro_reach_id, triton_hydro_gage_id, triton_extbc_entries,
  num_extbc                        -> StepRun.config of their step
  sim_duration                     -> StepRun.config (bdy) + surfaced on the
                                      project payload for the PAR step
  (No key is dropped: identity -> Aoi columns, step inputs -> StepRun.config,
   step outputs -> StepRun.manifest. The parent-ctx contamination problem
   _PER_AOI_KEYS existed to guard against disappears entirely: rows, not a
   shared dict.)
"""
import re
from datetime import datetime, timezone

from geoalchemy2 import Geometry
from sqlalchemy import (
    BigInteger, Boolean, Column, DateTime, Float, ForeignKey, Integer,
    String, Text, UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import relationship, sessionmaker

Base = declarative_base()

# Executable form of the coverage table above: every fimcore _PER_AOI_KEYS
# entry maps to its home in this schema. tests/test_models.py asserts this
# stays in sync with fimcore's tuple.
PER_AOI_KEY_HOMES = {
    "aoi_path": "Aoi.source_key",
    "aoi_feature_index": "Aoi.feature_index",
    "upstream_reach_id": "Aoi.lookup",
    "main_river_name": "Aoi.river_name",
    "main_feature_name": "Aoi.lookup",
    "num_sources": "Aoi.lookup",
    "upstream_x": "Aoi.lookup",
    "upstream_y": "Aoi.lookup",
    "flowlines_path": "StepRun.manifest[bci]",
    "dem_path": "StepRun.manifest[dem]",
    "dem_tif_path": "StepRun.manifest[dem]",
    "dem_ascii_path": "StepRun.manifest[dem]",
    "dem_res_m": "StepRun.config[dem]",
    "dem_source": "StepRun.config[dem]",
    "dem_epsg": "StepRun.config[dem]",
    "manning_ascii_path": "StepRun.manifest[manning]",
    "manning_tif_path": "StepRun.manifest[manning]",
    "lulc_path": "StepRun.manifest[manning]",
    "lulc_source": "StepRun.config[manning]",
    "triton_friction_path": "StepRun.manifest[manning]",   # TRITON post-MVP
    "triton_fric_mode": "StepRun.config[manning]",
    "par_fpfric": "StepRun.config[par]",
    "triton_extbc_path": "StepRun.manifest[bci]",
    "triton_src_loc_path": "StepRun.manifest[bci]",
    "triton_extbc_entries": "StepRun.config[bci]",
    "num_extbc": "StepRun.config[bci]",
    "triton_hyg_path": "StepRun.manifest[bdy]",
    "triton_hydro_helper_csv": "StepRun.manifest[bdy]",
    "triton_hydro_source": "StepRun.config[bdy]",
    "triton_hydro_reach_id": "StepRun.config[bdy]",
    "triton_hydro_gage_id": "StepRun.config[bdy]",
    "sim_duration": "StepRun.config[bdy]",
    "triton_cfg_path": "StepRun.manifest[par]",
}

# Step keys, in wizard order (mirrors reactapp/src/steps.ts).
STEP_KEYS = ("dem", "manning", "bci", "bdy", "par", "run")

STEPRUN_STATUSES = (
    "pending", "queued", "running", "uploading",
    "succeeded", "failed", "cancelled",
)

LOOKUP_STATUSES = ("pending", "running", "done", "failed")


def sanitize_name(name: str) -> str:
    """fimcore.project.clean_name parity (kept local so the web app never
    needs fimcore importable at request time)."""
    name = name.strip()
    name = re.sub(r'[<>:"/\\|?*]+', "_", name)
    name = re.sub(r"\s+", "_", name)
    name = re.sub(r"_+", "_", name)
    return name.strip("._")


class Project(Base):
    __tablename__ = "projects"
    __table_args__ = (UniqueConstraint("username", "name", name="uq_project_user_name"),)

    id = Column(Integer, primary_key=True)
    username = Column(String(150), nullable=False, index=True)  # portal user
    name = Column(String(120), nullable=False)
    created = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)

    aois = relationship("Aoi", back_populates="project",
                        cascade="all, delete-orphan", order_by="Aoi.id")

    def to_dict(self, with_aois=False):
        d = {
            "id": self.id,
            "name": self.name,
            "created": self.created.isoformat() + "Z",
            "aoi_count": len(self.aois),
        }
        if with_aois:
            d["aois"] = [a.to_dict() for a in self.aois]
        return d


class Aoi(Base):
    __tablename__ = "aois"

    id = Column(Integer, primary_key=True)
    project_id = Column(Integer, ForeignKey("projects.id", ondelete="CASCADE"),
                        nullable=False, index=True)
    name = Column(String(200), nullable=False)
    source = Column(String(16), nullable=False)          # upload | drawn | example
    source_key = Column(String(512))                     # storage key of the uploaded file (ctx: aoi_path)
    feature_index = Column(Integer, default=0)           # ctx: aoi_feature_index
    geometry = Column(Geometry("POLYGON", srid=4326), nullable=False)
    area_km2 = Column(Float)
    is_rectangular = Column(Boolean, default=False)
    working_crs_epsg = Column(Integer)                   # auto-picked UTM; user-overridable later

    # Lookup results (BE6 populates; FE3 displays)
    lookup_status = Column(String(16), default="pending", nullable=False)
    lookup_error = Column(Text)
    states = Column(JSONB)                               # [{"name","abbr"}]
    huc6_codes = Column(JSONB)                           # ["031501", ...]
    huc8_codes = Column(JSONB)
    river_name = Column(String(200))                     # ctx: main_river_name
    lookup = Column(JSONB)                               # the long tail: upstream_reach_id,
                                                         # upstream_x/y, num_sources, gages [...]

    project = relationship("Project", back_populates="aois")
    step_runs = relationship("StepRun", back_populates="aoi",
                             cascade="all, delete-orphan", order_by="StepRun.id")

    def geometry_geojson(self):
        from geoalchemy2.shape import to_shape
        from shapely.geometry import mapping
        return mapping(to_shape(self.geometry))

    def to_dict(self):
        return {
            "id": self.id,
            "project_id": self.project_id,
            "name": self.name,
            "geometry": self.geometry_geojson(),
            "source": self.source,
            "feature_index": self.feature_index,
            "area_km2": self.area_km2,
            "is_rectangular": self.is_rectangular,
            "working_crs_epsg": self.working_crs_epsg,
            "lookup_status": self.lookup_status,
            "lookup_error": self.lookup_error,
            "states": self.states,
            "huc6_codes": self.huc6_codes,
            "huc8_codes": self.huc8_codes,
            "river_name": self.river_name,
            "lookup": self.lookup,
            "steps": {
                key: run.to_summary_dict()
                for key in STEP_KEYS
                for run in [self.current_step_run(key)] if run is not None
            },
        }

    def current_step_run(self, step_key):
        """Latest non-superseded run for a step, or None."""
        candidates = [r for r in self.step_runs
                      if r.step_key == step_key and not r.superseded]
        return candidates[-1] if candidates else None


class StepRun(Base):
    __tablename__ = "step_runs"

    id = Column(Integer, primary_key=True)
    aoi_id = Column(Integer, ForeignKey("aois.id", ondelete="CASCADE"),
                    nullable=False, index=True)
    step_key = Column(String(16), nullable=False)        # dem|manning|bci|bdy|par|run
    status = Column(String(16), default="pending", nullable=False)
    superseded = Column(Boolean, default=False, nullable=False)  # re-run semantics

    config = Column(JSONB)      # the per_aoi_configs dict (request JSON)
    manifest = Column(JSONB)    # [{"key","name","bytes","content_type"}] — storage keys, never paths
    progress = Column(JSONB)    # [{"stage","current","total","message","at"}]
    log = Column(Text)          # unstructured passthrough lines
    error = Column(Text)

    job_id = Column(String(64))              # DaskJob id once BE5 submits it
    bytes_written = Column(BigInteger, default=0)  # BE10 quota accounting
    created = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    started = Column(DateTime)
    finished = Column(DateTime)

    aoi = relationship("Aoi", back_populates="step_runs")

    def to_summary_dict(self):
        return {
            "id": self.id,
            "status": self.status,
            "finished": self.finished.isoformat() + "Z" if self.finished else None,
        }

    def to_dict(self):
        return {
            "id": self.id,
            "aoi_id": self.aoi_id,
            "step_key": self.step_key,
            "status": self.status,
            "superseded": self.superseded,
            "config": self.config,
            "manifest": self.manifest,
            "progress": self.progress,
            "error": self.error,
            "job_id": self.job_id,
            "bytes_written": self.bytes_written,
            "created": self.created.isoformat() + "Z",
            "started": self.started.isoformat() + "Z" if self.started else None,
            "finished": self.finished.isoformat() + "Z" if self.finished else None,
        }


# ── Reference layers (loaded once by the initializer; queried by services.huc_lookup) ──

class RefHuc8(Base):
    __tablename__ = "ref_huc8"
    id = Column(Integer, primary_key=True)
    huc8 = Column(String(8), nullable=False, index=True)
    name = Column(String(200))
    geom = Column(Geometry("MULTIPOLYGON", srid=4326), nullable=False)


class RefHuc6(Base):
    __tablename__ = "ref_huc6"
    id = Column(Integer, primary_key=True)
    huc6 = Column(String(6), nullable=False, index=True)
    name = Column(String(200))
    geom = Column(Geometry("MULTIPOLYGON", srid=4326), nullable=False)


class RefState(Base):
    __tablename__ = "ref_states"
    id = Column(Integer, primary_key=True)
    name = Column(String(100), nullable=False)
    abbr = Column(String(2))
    geom = Column(Geometry("MULTIPOLYGON", srid=4326), nullable=False)


def get_session_maker(app_class):
    """Session factory bound to the app's primary_db persistent store."""
    engine = app_class.get_persistent_store_database("primary_db")
    return sessionmaker(bind=engine)


def init_primary_db(engine, first_time):
    """Tethys persistent-store initializer: create tables; load reference
    layers on first run (idempotent — skips tables that already hold rows)."""
    Base.metadata.create_all(engine)
    if first_time:
        from tethysapp.fimsim_gui.reference_loader import load_reference_layers
        load_reference_layers(engine, log=print)
