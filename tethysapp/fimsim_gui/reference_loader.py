"""Load the HUC8/HUC6/state reference GeoJSONs into PostGIS (FIMSIM-BE3).

Source of the data, in order of preference: the installed fimcore package's
bundled files, else an explicit directory (FIMSIM_REFERENCE_DATA_DIR env var,
useful while the portal env can't import fimcore). Idempotent: a table that
already has rows is skipped; pass force=True to reload.

Run standalone against the app's store with:
    tethys syncstores fimsim_gui          # first_time path calls this
or from `tethys manage shell`:
    from tethysapp.fimsim_gui.app import App
    from tethysapp.fimsim_gui.reference_loader import load_reference_layers
    load_reference_layers(App.get_persistent_store_database('primary_db'), force=True)
"""
import os
from pathlib import Path


def _data_dir():
    env = os.environ.get("FIMSIM_REFERENCE_DATA_DIR")
    if env:
        return Path(env)
    try:
        import fimcore
        return Path(fimcore.__file__).parent / "data"
    except ImportError:
        fallback = Path.home() / "tethysdev" / "fimcore" / "src" / "fimcore" / "data"
        if fallback.exists():
            return fallback
        raise RuntimeError(
            "Reference GeoJSONs not found: install fimcore or set "
            "FIMSIM_REFERENCE_DATA_DIR to a directory containing "
            "us_huc8.geojson / us_huc6.geojson / us_states.geojson."
        )


def _first_col(gdf, *candidates):
    for c in candidates:
        for col in gdf.columns:
            if col.lower() == c:
                return col
    return None


def _load_layer(engine, gdf, model, columns, log):
    """columns: {model_attr: (candidate_names...)} — first matching source column wins.

    Plain GeoAlchemy2 ORM inserts: geopandas.to_postgis is unusable here
    because the portal env pairs pandas 2.x with SQLAlchemy 1.4 (Tethys pin),
    and that combination sends geometry through pandas' legacy DBAPI path.
    """
    from geoalchemy2.shape import from_shape
    from shapely.geometry import MultiPolygon, Polygon
    from sqlalchemy.orm import sessionmaker

    resolved = {attr: _first_col(gdf, *cands) for attr, cands in columns.items()}
    Session = sessionmaker(bind=engine)
    session = Session()
    try:
        batch = []
        for _, row in gdf.iterrows():
            geom = row.geometry
            if isinstance(geom, Polygon):
                geom = MultiPolygon([geom])
            kwargs = {
                attr: (str(row[src]) if src is not None else None)
                for attr, src in resolved.items()
            }
            batch.append(model(geom=from_shape(geom, srid=4326), **kwargs))
            if len(batch) >= 500:
                session.bulk_save_objects(batch)
                batch = []
        if batch:
            session.bulk_save_objects(batch)
        session.commit()
    finally:
        session.close()
    log(f"  {model.__tablename__}: loaded {len(gdf)} features")


def _table_count(engine, table):
    from sqlalchemy import text
    with engine.connect() as conn:
        try:
            return conn.execute(text(f"SELECT count(*) FROM {table}")).scalar()
        except Exception:
            return 0


def load_reference_layers(engine, force=False, log=print):
    import geopandas as gpd
    from sqlalchemy import text

    data_dir = _data_dir()
    log(f"Loading reference layers from {data_dir} …")

    from tethysapp.fimsim_gui.models import RefHuc6, RefHuc8, RefState

    layers = [
        (RefHuc8, "us_huc8.geojson",
         {"huc8": ("huc8",), "name": ("name",)}),
        (RefHuc6, "us_huc6.geojson",
         {"huc6": ("huc6",), "name": ("name",)}),
        (RefState, "us_states.geojson",
         {"name": ("name", "state_name"), "abbr": ("abbr", "stusps", "state_abbr", "postal")}),
    ]
    for model, fname, columns in layers:
        table = model.__tablename__
        existing = _table_count(engine, table)
        if existing and not force:
            log(f"  {table}: {existing} rows already present — skipping")
            continue
        if existing and force:
            with engine.begin() as conn:
                conn.execute(text(f"DELETE FROM {table}"))
        gdf = gpd.read_file(data_dir / fname)
        # The bundled files are EPSG:4326 or EPSG:4269 (NAD83 geographic —
        # identical degrees at reference-layer precision; the desktop reads
        # them raw). Relabel rather than reproject; genuinely projected CRSs
        # would be a data bug worth failing on.
        if gdf.crs is None or gdf.crs.to_epsg() in (4326, 4269):
            gdf = gdf.set_crs(4326, allow_override=True)
        else:
            raise RuntimeError(
                f"{fname}: unexpected projected CRS {gdf.crs} — reference "
                f"layers are expected in geographic coordinates."
            )
        _load_layer(engine, gdf, model, columns, log)

    # spatial indexes (idempotent)
    with engine.begin() as conn:
        for table in ("ref_huc8", "ref_huc6", "ref_states"):
            conn.execute(text(
                f"CREATE INDEX IF NOT EXISTS idx_{table}_geom ON {table} USING GIST (geom)"
            ))
    log("Reference layers ready.")
