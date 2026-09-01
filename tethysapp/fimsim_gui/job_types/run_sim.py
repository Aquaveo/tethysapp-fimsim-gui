"""FIMSIM-BE8: the Run step — execute LISFLOOD-FP on the generated deck.

Subprocess job type: stages nothing extra (the deck is the restored
workspace's lisflood-files/), sanitizes versioned filenames (fimcore's
"Neuse (1).bdy" breaks LISFLOOD's whitespace-delimited .par parser — also
reported upstream), runs the solver with cooperative cancel + progress from
the results-file count, and post-processes res.max into a GeoTIFF plus a
web overlay (PNG + WGS84 bounds) for FE8's map.
"""
import json
import re
import shutil
import subprocess
import time
from pathlib import Path

from tethysapp.fimsim_gui.job_types.registry import StepJobType

_PAR_FILE_KEYS = ("DEMfile", "manningfile", "bcifile", "bdyfile", "SGCwidth",
                  "SGCbank", "SGCbed", "weirfile", "startfile", "loadcheck")


def _sanitize_deck(lf_dir: Path, log_fn) -> Path:
    """Rewrite model.par so every referenced filename is whitespace-free."""
    pars = sorted(lf_dir.glob("*.par"))
    if not pars:
        raise RuntimeError("No .par file in the deck — run the Settings step first.")
    par = pars[-1]
    out_lines = []
    for line in par.read_text().splitlines():
        tokens = line.split(None, 1)
        if len(tokens) == 2 and tokens[0] in _PAR_FILE_KEYS:
            fname = tokens[1].strip()
            if " " in fname and (lf_dir / fname).exists():
                safe = re.sub(r"[\s()]+", "_", fname).strip("_")
                shutil.copy2(lf_dir / fname, lf_dir / safe)
                log_fn(f"deck: renamed '{fname}' -> '{safe}' (spaces break the .par parser)")
                line = f"{tokens[0]:15s} {safe}"
        out_lines.append(line)
    par.write_text("\n".join(out_lines) + "\n")
    return par


def _read_prj_wkt(lf_dir: Path):
    for prj in sorted(lf_dir.glob("*.prj")):
        return prj.read_text().strip()
    return None


class RunSimJobType(StepJobType):
    step_key = "run"
    requires = ("par",)

    def defaults(self) -> dict:
        return {"solver_path": None, "solver_timeout_s": 3600,
                "keep_snapshots": False}

    def execute(self, ctx_path, ctx, config, log_fn):
        from tethysapp.fimsim_gui.geo_env import ensure_proj_data
        ensure_proj_data()

        cfg = self.merged(config)
        solver = cfg.get("solver_path")
        if not solver or not Path(solver).exists():
            raise RuntimeError(
                f"LISFLOOD-FP executable not found ({solver!r}) — set the "
                f"lisflood_binary_path app setting.")

        folder = Path(ctx["aoi_features"][0]["folder_path"])
        lf_dir = folder / "lisflood-files"
        par = _sanitize_deck(lf_dir, log_fn)

        # expected output count for progress: sim_time / saveint
        par_text = par.read_text()
        sim_time = float(re.search(r"^sim_time\s+([\d.]+)", par_text, re.M).group(1))
        saveint = float(re.search(r"^saveint\s+([\d.]+)", par_text, re.M).group(1))
        dirroot = (re.search(r"^dirroot\s+(\S+)", par_text, re.M) or [None, "results"])[1]
        expected = max(1, int(sim_time / saveint))
        results_dir = lf_dir / dirroot

        log_fn(f"▶ Simulation [1/1]: LISFLOOD-FP {par.name}, "
               f"{sim_time:.0f}s sim time, ~{expected} outputs …")
        proc = subprocess.Popen(
            [str(solver), par.name], cwd=str(lf_dir),
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, errors="replace", start_new_session=True,
        )
        deadline = time.time() + float(cfg["solver_timeout_s"])
        tail = []
        try:
            while True:
                rc = proc.poll()
                n_out = len(list(results_dir.glob("*.wd"))) if results_dir.is_dir() else 0
                # counter marker → structured progress event (also checks cancel/timeout)
                log_fn(f"Simulation progress: {min(n_out, expected)}/{expected}")
                if rc is not None:
                    break
                if time.time() > deadline:
                    raise RuntimeError(
                        f"solver exceeded its {cfg['solver_timeout_s']}s budget")
                time.sleep(2)
        except BaseException:
            # cooperative cancel/timeout raised inside log_fn → kill the process tree
            try:
                import os, signal
                os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
            except Exception:
                pass
            raise
        finally:
            out = proc.stdout.read() if proc.stdout else ""
            tail = out.splitlines()[-30:]
            for line in tail:
                log_fn(line)

        if proc.returncode != 0:
            raise RuntimeError(
                f"LISFLOOD-FP exited with code {proc.returncode}:\n" + "\n".join(tail))
        max_file = next(iter(results_dir.glob("*.max")), None)
        if max_file is None:
            raise RuntimeError(
                "solver finished but produced no .max output:\n" + "\n".join(tail))
        log_fn(f"✓ Simulation [1/1] finished: {max_file.name}")
        ctx["_run_results_dir"] = str(results_dir)
        ctx["_run_keep_snapshots"] = bool(cfg.get("keep_snapshots"))

    def collect(self, ctx, workdir) -> str:
        import numpy as np
        import rasterio
        from rasterio.warp import transform_bounds

        folder = Path(ctx["aoi_features"][0]["folder_path"])
        results_dir = Path(ctx["_run_results_dir"])
        outputs = Path(workdir) / "outputs"
        outputs.mkdir(exist_ok=True)

        max_file = next(iter(results_dir.glob("*.max")))
        shutil.copy2(max_file, outputs / "max_depth.ascii")
        for extra in ("*.mass",):
            for p in results_dir.glob(extra):
                shutil.copy2(p, outputs / p.name)

        # Optional: every saveint water-depth slice, bundled (desktop parity —
        # it keeps all res-NNNN.wd files; ~100s of grids, so zipped and off
        # by default)
        if ctx.get("_run_keep_snapshots"):
            import zipfile
            wds = sorted(results_dir.glob("*.wd"))
            if wds:
                with zipfile.ZipFile(outputs / "depth_snapshots.zip", "w",
                                     zipfile.ZIP_DEFLATED) as zf:
                    for p in wds:
                        zf.write(p, p.name)

        wkt = _read_prj_wkt(folder / "lisflood-files")
        with rasterio.open(max_file) as src:
            depth = src.read(1).astype("float32")
            profile = src.profile.copy()
            nodata = src.nodata if src.nodata is not None else -9999.0
            crs = rasterio.crs.CRS.from_wkt(wkt) if wkt else src.crs
            bounds = src.bounds

        depth[depth == nodata] = 0.0
        profile.update(driver="GTiff", dtype="float32", count=1, crs=crs,
                       nodata=0.0, compress="lzw")
        with rasterio.open(outputs / "max_depth.tif", "w", **profile) as dst:
            dst.write(depth, 1)

        # Web overlay: blue ramp PNG + WGS84 bounds for MapLibre's image source
        wet = depth > 0.01
        top = np.percentile(depth[wet], 98) if wet.any() else 1.0
        norm = np.clip(depth / max(top, 0.01), 0, 1)
        rgba = np.zeros((4, *depth.shape), dtype="uint8")
        rgba[0] = (30 + 20 * (1 - norm)).astype("uint8")          # R
        rgba[1] = (100 + 60 * (1 - norm)).astype("uint8")         # G
        rgba[2] = (140 + 115 * norm).astype("uint8")              # B
        rgba[3] = np.where(wet, (120 + 135 * norm), 0).astype("uint8")  # A
        png_profile = dict(driver="PNG", width=depth.shape[1],
                           height=depth.shape[0], count=4, dtype="uint8")
        with rasterio.open(outputs / "max_depth_overlay.png", "w", **png_profile) as dst:
            dst.write(rgba)

        w, s, e, n = transform_bounds(crs, "EPSG:4326", *bounds)
        stats = {
            "bounds": {"west": w, "south": s, "east": e, "north": n},
            "max_depth_m": float(depth.max()),
            "wet_fraction": float(wet.mean()),
            "wet_area_km2": float(wet.sum() * abs(profile["transform"].a
                                                  * profile["transform"].e) / 1e6),
        }
        (outputs / "overlay_bounds.json").write_text(json.dumps(stats, indent=2))
        return str(outputs)
