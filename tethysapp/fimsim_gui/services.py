"""FIMSIM-BE3 services: spatial lookups against the reference tables.

PostGIS is the primary backend; when the persistent store lacks PostGIS (open
question for the CIROH portal) or the reference tables are empty, lookups fall
back to fimcore's bundled-GeoJSON path. `lookup_backend()` reports which one
is live so the ask can be surfaced honestly.
"""
import json
import logging

from sqlalchemy import text

logger = logging.getLogger(__name__)


def _engine():
    from tethysapp.fimsim_gui.app import App
    return App.get_persistent_store_database("primary_db")


def _postgis_ready(engine) -> bool:
    try:
        with engine.connect() as conn:
            n = conn.execute(text("SELECT count(*) FROM ref_huc8")).scalar()
        return bool(n)
    except Exception:
        return False


def lookup_backend() -> str:
    """'postgis' when the reference tables are loaded, else 'fimcore-fallback'."""
    return "postgis" if _postgis_ready(_engine()) else "fimcore-fallback"


def _intersect_codes(engine, table, code_col, geojson_geom) -> list:
    sql = text(f"""
        SELECT DISTINCT {code_col} FROM {table}
        WHERE ST_Intersects(geom, ST_SetSRID(ST_GeomFromGeoJSON(:g), 4326))
        ORDER BY {code_col}
    """)
    with engine.connect() as conn:
        rows = conn.execute(sql, {"g": json.dumps(geojson_geom)}).fetchall()
    return [r[0] for r in rows]


def _intersect_states(engine, geojson_geom) -> list:
    sql = text("""
        SELECT DISTINCT name, abbr FROM ref_states
        WHERE ST_Intersects(geom, ST_SetSRID(ST_GeomFromGeoJSON(:g), 4326))
        ORDER BY name
    """)
    with engine.connect() as conn:
        rows = conn.execute(sql, {"g": json.dumps(geojson_geom)}).fetchall()
    return [{"name": r[0], "abbr": r[1]} for r in rows]


def resolve_aoi_context(geojson_geom: dict) -> dict:
    """States + HUC6 + HUC8 for a WGS84 GeoJSON polygon geometry.

    Fast path: PostGIS reference tables (<100 ms). Fallback: fimcore's bundled
    GeoJSONs (slower, needs fimcore importable). River/gage detection is NOT
    here — that's network NHD work and runs as a BE5 job (see FIMSIM-BE6).
    """
    engine = _engine()
    if _postgis_ready(engine):
        return {
            "backend": "postgis",
            "states": _intersect_states(engine, geojson_geom),
            "huc6_codes": _intersect_codes(engine, "ref_huc6", "huc6", geojson_geom),
            "huc8_codes": _intersect_codes(engine, "ref_huc8", "huc8", geojson_geom),
        }

    logger.warning("Reference tables unavailable — using fimcore fallback lookups.")
    import geopandas as gpd
    from shapely.geometry import shape
    import fimcore  # noqa: F401 — fails loudly if neither backend is available
    from pathlib import Path

    data_dir = Path(fimcore.__file__).parent / "data"
    geom = shape(geojson_geom)

    def _codes(fname, col):
        gdf = gpd.read_file(data_dir / fname)
        hits = gdf[gdf.intersects(geom)]
        c = next((c for c in hits.columns if c.lower() == col), None)
        return sorted(hits[c].astype(str).unique().tolist()) if c is not None else []

    states_gdf = gpd.read_file(data_dir / "us_states.geojson")
    s_hits = states_gdf[states_gdf.intersects(geom)]
    name_c = next((c for c in s_hits.columns if c.lower() in ("name", "state_name")), None)
    abbr_c = next((c for c in s_hits.columns
                   if c.lower() in ("abbr", "stusps", "state_abbr", "postal")), None)
    states = [
        {"name": str(r[name_c]) if name_c else None,
         "abbr": str(r[abbr_c]) if abbr_c else None}
        for _, r in s_hits.iterrows()
    ]
    return {
        "backend": "fimcore-fallback",
        "states": states,
        "huc6_codes": _codes("us_huc6.geojson", "huc6"),
        "huc8_codes": _codes("us_huc8.geojson", "huc8"),
    }
