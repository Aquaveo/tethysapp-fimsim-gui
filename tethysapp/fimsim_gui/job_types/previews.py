"""Per-step preview artifacts (the visuals plan, Phase 1).

Small worker-side emitters called from job collect() hooks. Everything ships
through the run's outputs manifest and the same-origin file proxy — the same
proven pipeline as the flood overlay. Reprojection to WGS84 happens HERE,
where the working CRS is unambiguous (the desktop's own code warns that
boundary coordinates live in the DEM's projected CRS — the browser must
never guess).
"""
import json
from pathlib import Path

#: desktop symbology, verbatim (gui/bci_preview.py) — shipped with the
#: GeoJSON so the frontend can't drift from it
BOUNDARY_STYLE = {
    "main_river": {"color": "#2b6cb0", "width": 2.0},
    "upstream": {"fill": "#f6ad55", "ring": "#744210"},
    "downstream": {"fill": "#f56565", "ring": "#742a2a"},
}


def _feat_ctx(ctx) -> dict:
    """The per-AOI workflow context — fimcore round-trips the detected
    boundary keys (upstream_x/y, …) into the AOI folder's own ctx json."""
    folder = Path(ctx["aoi_features"][0]["folder_path"])
    p = folder / "workflow_context.json"
    merged = dict(ctx)
    if p.exists():
        try:
            merged.update(json.loads(p.read_text()))
        except Exception:
            pass
    return merged


def write_boundary_preview(ctx, outputs, log_fn=lambda *_: None):
    """preview_features.geojson: main river + upstream/downstream markers,
    WGS84. Returns the path or None (a missing river/points is not an error —
    the desktop also draws only what exists)."""
    from tethysapp.fimsim_gui.geo_env import ensure_proj_data
    ensure_proj_data()

    fc = _feat_ctx(ctx)
    folder = Path(fc["aoi_features"][0]["folder_path"]) if "aoi_features" in fc \
        else Path(ctx["aoi_features"][0]["folder_path"])
    features = []

    river = folder / "main_river_line.gpkg"
    if river.exists():
        try:
            import geopandas as gpd
            gdf = gpd.read_file(river).to_crs(4326)
            row = gdf.iloc[0]
            geom = row.geometry.simplify(0.0002)
            from shapely.geometry import mapping
            features.append({
                "type": "Feature",
                "properties": {"kind": "main_river",
                               "name": str(row.get("river_name", "Main river"))},
                "geometry": mapping(geom),
            })
        except Exception as exc:
            log_fn(f"preview: river line skipped ({exc})")

    epsg = fc.get("working_crs_epsg") \
        or fc["aoi_features"][0].get("working_crs_epsg")
    if epsg:
        from pyproj import Transformer
        tf = Transformer.from_crs(f"EPSG:{int(epsg)}", "EPSG:4326",
                                  always_xy=True)
        for kind in ("upstream", "downstream"):
            x, y = fc.get(f"{kind}_x"), fc.get(f"{kind}_y")
            if x is None or y is None:
                continue
            lon, lat = tf.transform(float(x), float(y))
            if not (-180 <= lon <= 180 and -90 <= lat <= 90):
                log_fn(f"preview: {kind} point reprojection looks wrong "
                       f"({lon}, {lat}) — skipped")
                continue
            features.append({
                "type": "Feature",
                "properties": {"kind": kind},
                "geometry": {"type": "Point", "coordinates": [lon, lat]},
            })

    if not features:
        return None
    out = Path(outputs) / "preview_features.geojson"
    out.write_text(json.dumps({
        "type": "FeatureCollection",
        "style": BOUNDARY_STYLE,
        "features": features,
    }))
    log_fn(f"preview: boundary map ({len(features)} feature(s))")
    return out
