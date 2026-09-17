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


#: long-edge cap for preview PNGs — rendered from a downsampled read so the
#: worker never holds a full-resolution array just for a thumbnail
PREVIEW_MAX_PX = 1200


def _downsampled(src, max_px=PREVIEW_MAX_PX):
    """Masked band-1 read at preview resolution."""
    scale = max(src.width, src.height) / max_px
    if scale <= 1:
        return src.read(1, masked=True)
    out_w = max(1, round(src.width / scale))
    out_h = max(1, round(src.height / scale))
    return src.read(1, masked=True, out_shape=(out_h, out_w))


def _wgs84_bounds(src):
    from rasterio.warp import transform_bounds
    w, s, e, n = transform_bounds(src.crs, "EPSG:4326", *src.bounds)
    return {"west": w, "south": s, "east": e, "north": n}


def write_dem_preview(ctx, outputs, log_fn=lambda *_: None):
    """Terrain preview: colormapped elevation PNG (desktop's `terrain` ramp,
    nodata transparent) + bounds/stats/ramp JSON."""
    import numpy as np
    import rasterio
    from matplotlib import colormaps

    from tethysapp.fimsim_gui.geo_env import ensure_proj_data
    ensure_proj_data()

    folder = Path(ctx["aoi_features"][0]["folder_path"])
    tif = next(iter(sorted(folder.glob("DEM_*.tif"))), None)
    if tif is None:
        return None
    with rasterio.open(tif) as src:
        arr = _downsampled(src)
        bounds = _wgs84_bounds(src)
        res = float(abs(src.res[0]))
        size = (src.width, src.height)
        crs = str(src.crs)

    valid = arr.compressed()
    if valid.size == 0:
        return None
    vmin, vmax = float(np.percentile(valid, 1)), float(np.percentile(valid, 99))
    if vmax <= vmin:
        vmax = vmin + 1.0
    norm = np.clip((arr.filled(vmin) - vmin) / (vmax - vmin), 0, 1)
    cmap = colormaps["terrain"]
    rgba = (cmap(norm) * 255).astype("uint8")
    rgba[..., 3] = np.where(arr.mask, 0, 255)  # nodata transparent (web deviation)

    _write_png(Path(outputs) / "preview_dem.png", rgba)
    ramp = [_hex(cmap(v)) for v in np.linspace(0, 1, 12)]
    (Path(outputs) / "preview_dem.json").write_text(json.dumps({
        "kind": "dem", "bounds": bounds,
        "stats": {"min_m": float(valid.min()), "max_m": float(valid.max()),
                  "mean_m": float(valid.mean()), "res_m": res,
                  "width_px": size[0], "height_px": size[1], "crs": crs},
        "legend": {"ramp": ramp, "vmin": vmin, "vmax": vmax,
                   "label": "Elevation (m)"},
    }))
    log_fn("preview: terrain map")
    return True


def write_manning_preview(ctx, outputs, lulc_source, manning_mapping=None,
                          log_fn=lambda *_: None):
    """Roughness previews: LULC class PNG (tab20 palette) + Manning-n PNG
    (YlGnBu) + a class-breakdown table computed the desktop's way (pixel
    counts → km² and % area, sorted by dominance) — the table also closes
    FIMSIM-BE12's coverage-% ask."""
    import numpy as np
    import rasterio
    from matplotlib import colormaps

    from tethysapp.fimsim_gui.geo_env import ensure_proj_data
    ensure_proj_data()

    folder = Path(ctx["aoi_features"][0]["folder_path"])
    lulc_tif = next(iter(sorted(folder.glob("LULC_*.tif"))), None)
    manning_tif = next(iter(sorted(folder.glob("ManningN_*.tif"))), None)
    if lulc_tif is None:
        return None

    from fimcore.nlcd import NLCD_MANNING, SENTINEL2_MANNING
    table = NLCD_MANNING if "nlcd" in str(lulc_source).lower() else SENTINEL2_MANNING

    with rasterio.open(lulc_tif) as src:
        arr = _downsampled(src)
        bounds = _wgs84_bounds(src)
        # class stats from the FULL raster (counts must be exact, reads are
        # int codes — cheap even at full size)
        full = src.read(1, masked=True)
        px_m2 = abs(src.transform.a * src.transform.e)

    codes, counts = np.unique(full.compressed().astype(int), return_counts=True)
    order = np.argsort(-counts)
    total = counts.sum() or 1
    tab20 = colormaps["tab20"]
    classes = []
    code_color = {}
    for rank, i in enumerate(order):
        code = int(codes[i])
        name, _mn, _mx, default_n = table.get(
            code, (f"Class {code}", None, None, None))
        n_val = (manning_mapping or {}).get(str(code), default_n)
        color = _hex(tab20(rank % 20))
        code_color[code] = color
        classes.append({
            "code": code, "name": name, "color": color,
            "area_km2": round(float(counts[i]) * px_m2 / 1e6, 3),
            "pct": round(100.0 * counts[i] / total, 1),
            "n": n_val,
        })

    rgba = np.zeros((*arr.shape, 4), dtype="uint8")
    for code, color in code_color.items():
        m = arr.filled(-1).astype(int) == code
        rgba[m] = [*_rgb(color), 255]
    _write_png(Path(outputs) / "preview_lulc.png", rgba)

    manning_ok = False
    if manning_tif is not None:
        with rasterio.open(manning_tif) as src:
            n_arr = _downsampled(src)
        n_valid = n_arr.compressed()
        n_valid = n_valid[n_valid > 0]
        if n_valid.size:
            nmin, nmax = float(n_valid.min()), float(n_valid.max())
            span = (nmax - nmin) or 0.01
            norm = np.clip((n_arr.filled(nmin) - nmin) / span, 0, 1)
            cmap = colormaps["YlGnBu"]
            n_rgba = (cmap(norm) * 255).astype("uint8")
            bad = n_arr.mask | (n_arr.filled(0) <= 0)
            n_rgba[..., 3] = np.where(bad, 0, 255)
            _write_png(Path(outputs) / "preview_manning.png", n_rgba)
            manning_ok = True

    (Path(outputs) / "preview_lulc.json").write_text(json.dumps({
        "kind": "lulc", "bounds": bounds, "classes": classes,
        "has_manning": manning_ok,
    }))
    log_fn(f"preview: land-cover map ({len(classes)} class(es))"
           + (" + Manning map" if manning_ok else ""))
    return True


def _write_png(path: Path, rgba) -> None:
    import rasterio
    h, w = rgba.shape[:2]
    with rasterio.open(path, "w", driver="PNG", width=w, height=h,
                       count=4, dtype="uint8") as dst:
        for band in range(4):
            dst.write(rgba[..., band], band + 1)
    # rasterio's PNG driver writes a sidecar .aux.xml — not an output
    aux = path.with_suffix(path.suffix + ".aux.xml")
    aux.unlink(missing_ok=True)


def _hex(rgba01) -> str:
    r, g, b = (int(round(c * 255)) for c in rgba01[:3])
    return f"#{r:02x}{g:02x}{b:02x}"


def _rgb(hex_color: str):
    h = hex_color.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


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
