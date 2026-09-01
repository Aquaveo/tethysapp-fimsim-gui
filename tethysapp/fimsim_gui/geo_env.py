"""Deterministic PROJ data selection (the tethys env's recurring inf-bug).

The env mixes conda `proj` (needed by conda `gdal`; its activate script
exports PROJ_DATA → a layout-1.6 database) with pip `pyproj`/`rasterio`
wheels that bundle their own PROJ (layout 1.4). When the wheels read the
conda database, every transform silently returns inf — observed 08-25,
"gone" 08-27, back 08-31 depending on which shell spawned the process.

Fix: point each wheel at its own bundled data explicitly (process-local;
set_data_dir beats the env var). conda-gdal keeps using PROJ_DATA. Call
ensure_proj_data() at the top of anything that transforms coordinates —
idempotent and cheap.
"""
from pathlib import Path

_done = False


def ensure_proj_data() -> None:
    global _done
    if _done:
        return
    import pyproj
    import pyproj.datadir

    wheel = Path(pyproj.__file__).parent / "proj_dir" / "share" / "proj"
    if (wheel / "proj.db").exists():
        pyproj.datadir.set_data_dir(str(wheel))
    try:
        import rasterio
        from rasterio._env import set_proj_data_search_path

        rio = Path(rasterio.__file__).parent / "proj_data"
        if (rio / "proj.db").exists():
            set_proj_data_search_path(str(rio))
    except Exception:
        pass  # rasterio wheel layout differs → sanity check will catch real breakage
    _done = True
