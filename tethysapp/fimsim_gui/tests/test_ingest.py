"""FIMSIM-BE6 ingestion tests — the three accepted formats (using the desktop
repo's bundled test AOIs), every rejection path, and the zip-slip guard."""
import json
import zipfile
from pathlib import Path

import pytest

from tethysapp.fimsim_gui.ingest import (
    IngestError, MAX_UPLOAD_BYTES, ingest_aoi_file, ingest_geojson_geometry,
)

FIMSIM_TEST_CASES = Path.home() / "random" / "FIMsim" / "test_case"
NEUSE_DIR = FIMSIM_TEST_CASES / "AOI_1_Neuse"

pytestmark = pytest.mark.skipif(
    not NEUSE_DIR.exists(), reason="FIMsim test_case AOIs not available")

NEUSE_RING = [
    [-78.10992, 35.45282], [-77.93055, 35.44839],
    [-77.93668, 35.28632], [-78.1157, 35.29072], [-78.10992, 35.45282],
]


def _zip_of(directory: Path, dest: Path) -> Path:
    zpath = dest / f"{directory.name}.zip"
    with zipfile.ZipFile(zpath, "w") as zf:
        for f in directory.iterdir():
            zf.write(f, f.name)
    return zpath


# ── happy paths: zip / gpkg / geojson ────────────────────────────────────────

def test_zipped_shapefile(tmp_path):
    z = _zip_of(NEUSE_DIR, tmp_path)
    res = ingest_aoi_file(z, z.name, z.stat().st_size)
    assert len(res.features) == 1
    f = res.features[0]
    assert f.in_conus and f.is_rectangular          # UTM rectangle passes
    assert f.working_crs_epsg == 26917              # honors the file's own CRS
    assert 280 < f.area_km2 < 300


def test_geopackage(tmp_path):
    import geopandas as gpd
    gpkg = tmp_path / "neuse.gpkg"
    gpd.read_file(NEUSE_DIR / "AOI_1.shp").to_file(gpkg, driver="GPKG")
    res = ingest_aoi_file(gpkg, gpkg.name, gpkg.stat().st_size)
    assert len(res.features) == 1


def test_geojson_multi_feature_fanout(tmp_path):
    fc = {"type": "FeatureCollection", "features": [
        {"type": "Feature", "properties": {"name": f"box{i}"},
         "geometry": {"type": "Polygon", "coordinates": [[
             [-78 + i, 35], [-77.9 + i, 35], [-77.9 + i, 35.1],
             [-78 + i, 35.1], [-78 + i, 35]]]}}
        for i in range(3)
    ]}
    p = tmp_path / "boxes.geojson"
    p.write_text(json.dumps(fc))
    res = ingest_aoi_file(p, p.name, p.stat().st_size)
    assert [f.name for f in res.features] == ["box0", "box1", "box2"]
    assert all(f.is_rectangular for f in res.features)


def test_drawn_geometry():
    res = ingest_geojson_geometry(
        {"type": "Polygon", "coordinates": [NEUSE_RING]}, "Drawn AOI 1")
    f = res.features[0]
    assert f.is_rectangular and f.in_conus and f.working_crs_epsg == 26917


# ── rejections ────────────────────────────────────────────────────────────────

def test_rejects_oversize():
    with pytest.raises(IngestError, match="limit"):
        ingest_aoi_file("/nonexistent", "big.zip", MAX_UPLOAD_BYTES + 1)


def test_rejects_zip_slip(tmp_path):
    z = tmp_path / "evil.zip"
    with zipfile.ZipFile(z, "w") as zf:
        zf.writestr("../../outside.shp", b"nope")
    with pytest.raises(IngestError, match="unsafe"):
        ingest_aoi_file(z, z.name, z.stat().st_size)


def test_rejects_zip_without_shp(tmp_path):
    z = tmp_path / "empty.zip"
    with zipfile.ZipFile(z, "w") as zf:
        zf.writestr("readme.txt", b"hello")
    with pytest.raises(IngestError, match="no .shp"):
        ingest_aoi_file(z, z.name, z.stat().st_size)


def test_rejects_unknown_extension(tmp_path):
    p = tmp_path / "aoi.kml"
    p.write_text("<kml/>")
    with pytest.raises(IngestError, match="Unsupported"):
        ingest_aoi_file(p, p.name, p.stat().st_size)


def test_rejects_missing_crs(tmp_path):
    # naked geometry-only geojson written without CRS via fiona? GeoJSON is
    # 4326 by spec so geopandas assigns it — instead exercise via a shapefile
    # missing its .prj
    import geopandas as gpd
    shp_dir = tmp_path / "nocrs"
    shp_dir.mkdir()
    gdf = gpd.read_file(NEUSE_DIR / "AOI_1.shp")
    gdf = gdf.set_crs(None, allow_override=True) if gdf.crs else gdf
    import warnings
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        gdf.to_file(shp_dir / "nocrs.shp")
    (shp_dir / "nocrs.prj").unlink(missing_ok=True)
    z = _zip_of(shp_dir, tmp_path)
    with pytest.raises(IngestError, match="coordinate reference"):
        ingest_aoi_file(z, z.name, z.stat().st_size)


def test_rejects_self_intersecting():
    bowtie = {"type": "Polygon", "coordinates": [[
        [-78, 35], [-77.9, 35.1], [-77.9, 35], [-78, 35.1], [-78, 35]]]}
    with pytest.raises(IngestError, match="invalid geometry"):
        ingest_geojson_geometry(bowtie, "bowtie")


def test_rejects_outside_conus():
    paris = {"type": "Polygon", "coordinates": [[
        [2.2, 48.8], [2.4, 48.8], [2.4, 48.9], [2.2, 48.9], [2.2, 48.8]]]}
    with pytest.raises(IngestError, match="continental US"):
        ingest_geojson_geometry(paris, "paris")


def test_rejects_no_polygons(tmp_path):
    fc = {"type": "FeatureCollection", "features": [
        {"type": "Feature", "properties": {},
         "geometry": {"type": "Point", "coordinates": [-78, 35]}}]}
    p = tmp_path / "pts.geojson"
    p.write_text(json.dumps(fc))
    with pytest.raises(IngestError, match="No polygon"):
        ingest_aoi_file(p, p.name, p.stat().st_size)


def test_non_rectangular_flagged_not_rejected():
    tri_ish = {"type": "Polygon", "coordinates": [[
        [-78, 35], [-77.9, 35], [-77.95, 35.1], [-78.02, 35.05], [-78, 35]]]}
    res = ingest_geojson_geometry(tri_ish, "quad")
    assert res.features[0].is_rectangular is False   # flagged; BE7 gates on it


def test_no_crs_but_degree_coords_gets_assigned_4326(tmp_path):
    import warnings

    import geopandas as gpd
    from shapely.geometry import Polygon
    shp_dir = tmp_path / "deg_nocrs"
    shp_dir.mkdir()
    poly = Polygon([(-78.1, 35.4), (-77.95, 35.4), (-77.95, 35.3), (-78.1, 35.3)])
    gdf = gpd.GeoDataFrame({"name": ["x"]}, geometry=[poly])
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        gdf.to_file(shp_dir / "deg.shp")
    (shp_dir / "deg.prj").unlink(missing_ok=True)
    z = _zip_of(shp_dir, tmp_path)
    res = ingest_aoi_file(z, z.name, z.stat().st_size)
    assert res.features[0].in_conus
    assert res.warnings and "assumed WGS84" in res.warnings[0]
