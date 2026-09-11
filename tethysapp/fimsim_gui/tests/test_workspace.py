"""Workspace-hygiene regressions: restored workspaces must not let stale
files shadow fresh ones (the 'dry rerun executed a superseded deck' bug),
and deleting a project/AOI must remove its stored files."""
from pathlib import Path

from tethysapp.fimsim_gui.job_types import REGISTRY


def _fake_ctx(folder: Path) -> dict:
    return {"aoi_features": [{"folder_path": str(folder)}]}


def _touch(folder: Path, *names) -> None:
    for n in names:
        p = folder / n
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text("x")


def test_clean_workspace_removes_stale_and_versioned_outputs(tmp_path):
    lf = tmp_path / "lisflood-files"
    _touch(tmp_path, "DEM_Neuse.tif", "LULC_Neuse_2023.tif", "keepme.csv")
    _touch(lf, "dem.ascii", "dem (1).ascii", "dem.prj", "Neuse.bci",
           "Neuse (1).bci", "Neuse.bdy", "model.par", "model (1).par")
    (lf / "results").mkdir()
    (lf / "results" / "res.max").write_text("x")

    logs = []
    REGISTRY["dem"].clean_workspace(_fake_ctx(tmp_path), logs.append)
    assert not (lf / "dem.ascii").exists()
    assert not (lf / "dem (1).ascii").exists()          # versioned leftover too
    assert not (tmp_path / "DEM_Neuse.tif").exists()
    assert (lf / "Neuse.bci").exists()                  # other steps untouched
    assert (tmp_path / "keepme.csv").exists()

    REGISTRY["bci"].clean_workspace(_fake_ctx(tmp_path), logs.append)
    assert not (lf / "Neuse.bci").exists()
    assert not (lf / "Neuse (1).bci").exists()
    assert (lf / "Neuse.bdy").exists()

    REGISTRY["run"].clean_workspace(_fake_ctx(tmp_path), logs.append)
    assert not (lf / "results").exists()                # stale solver outputs

    assert any("superseded" in line for line in logs)


def test_sanitize_deck_prefers_the_newest_par(tmp_path):
    import os

    from tethysapp.fimsim_gui.job_types.run_sim import _sanitize_deck

    lf = tmp_path / "lisflood-files"
    lf.mkdir()
    stale = lf / "model.par"
    stale.write_text("DEMfile dem.ascii\n")
    fresh = lf / "model (1).par"        # sorts BEFORE 'model.par' alphabetically
    fresh.write_text("DEMfile dem.ascii\n")
    past = stale.stat().st_mtime - 100
    os.utime(stale, (past, past))

    picked = _sanitize_deck(lf, lambda *_: None)
    assert picked.name == "model (1).par"


def test_delete_prefix_removes_everything_under_it(tmp_path):
    from django.core.files.storage import FileSystemStorage

    from tethysapp.fimsim_gui.storage import StorageService

    backend = FileSystemStorage(location=str(tmp_path))
    svc = StorageService(backend)
    for key in ("u/1/a.txt", "u/1/2/deep.txt", "u/2/other.txt"):
        Path(tmp_path, key).parent.mkdir(parents=True, exist_ok=True)
        Path(tmp_path, key).write_text("x")

    removed = svc.delete_prefix("u/1")
    assert removed == 2
    assert not Path(tmp_path, "u/1/a.txt").exists()
    assert not Path(tmp_path, "u/1/2/deep.txt").exists()
    assert Path(tmp_path, "u/2/other.txt").exists()     # sibling untouched
