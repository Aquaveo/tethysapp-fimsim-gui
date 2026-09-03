"""FIMSIM-BE4 storage tests.

The same suite runs against BOTH backends (local filesystem + moto-mocked S3)
— that parity is the whole point of the wrapper. A live-MinIO integration
test runs when FIMSIM_TEST_MINIO_* env vars are set (moto alone missed real
MinIO behaviors on FIMeval — the precedent this test exists for).
"""
import os
from types import SimpleNamespace

import pytest

from tethysapp.fimsim_gui.storage import (
    StorageKeyError, assert_owned, build_key, make_local_service,
    make_s3_service, safe_filename, user_prefix,
)


# ── Key scheme + isolation (backend-independent) ─────────────────────────────

def test_build_key_scheme():
    assert build_key("reshma", 3, 7, "dem", "DEM_AOI_1.tif") == \
        "reshma/3/7/dem/DEM_AOI_1.tif"
    assert build_key("reshma", 3) == "reshma/3"


def test_filename_sanitization():
    assert safe_filename("../../etc/passwd") == "passwd"
    assert safe_filename("weird name (v2).tif") == "weird_name_v2_.tif"
    with pytest.raises(StorageKeyError):
        safe_filename("..")


def test_key_segments_validated():
    with pytest.raises(StorageKeyError):
        build_key("reshma", 3, 7, "dem/../evil", "f.tif")
    with pytest.raises(StorageKeyError):
        build_key("", 3)


def test_user_isolation():
    key = build_key("reshma", 3, 7, "dem", "a.tif")
    assert assert_owned(key, "reshma") == key
    with pytest.raises(StorageKeyError):
        assert_owned(key, "someone_else")
    with pytest.raises(StorageKeyError):
        assert_owned("reshma/../other/1/x", "reshma")
    with pytest.raises(StorageKeyError):
        assert_owned("/reshma/3/x", "reshma")
    # prefix must match on a segment boundary, not a substring
    with pytest.raises(StorageKeyError):
        assert_owned("reshma2/3/x", "reshma")


def test_user_prefix_rejects_garbage():
    assert user_prefix("reshma") == "reshma"
    with pytest.raises(StorageKeyError):
        user_prefix("///")


# ── Backend parity suite ──────────────────────────────────────────────────────

@pytest.fixture(params=["local", "s3"])
def storage(request, tmp_path):
    if request.param == "local":
        yield make_local_service(tmp_path / "store")
    else:
        moto = pytest.importorskip("moto")
        with moto.mock_aws():
            os.environ.setdefault("AWS_DEFAULT_REGION", "us-east-1")
            yield make_s3_service(
                access_key="test", secret_key="test", bucket="fimsim-test",
                ensure_bucket=True,
            )


def test_save_open_size_delete_roundtrip(storage):
    key = build_key("reshma", 1, 1, "dem", "dem.ascii")
    payload = b"ncols 5\nnrows 5\n" + b"x" * 100
    storage.save(key, payload)
    assert storage.exists(key)
    assert storage.size(key) == len(payload)
    with storage.open(key) as fh:
        assert fh.read() == payload
    # overwrite keeps the exact key (no django-storages name mangling)
    storage.save(key, b"short")
    assert storage.size(key) == 5
    storage.delete(key)
    assert not storage.exists(key)


def test_list_prefix_and_usage(storage):
    storage.save(build_key("reshma", 1, 1, "dem", "a.tif"), b"12345")
    storage.save(build_key("reshma", 1, 1, "manning", "b.tif"), b"123")
    storage.save(build_key("intruder", 9, 9, "dem", "c.tif"), b"1234567")
    listed = dict(storage.list_prefix_with_sizes("reshma"))
    assert set(listed.values()) == {5, 3}
    assert storage.usage_bytes("reshma") == 8
    assert storage.usage_bytes("intruder") == 7


def _fake_steprun(tmp_path, step_key="dem"):
    project = SimpleNamespace(username="reshma", id=4)
    aoi = SimpleNamespace(id=2, project=project)
    return SimpleNamespace(aoi=aoi, step_key=step_key, manifest=None,
                           bytes_written=0)


def test_store_outputs_and_stage_inputs(storage, tmp_path):
    scratch = tmp_path / "scratch"
    (scratch / "sub").mkdir(parents=True)
    (scratch / "DEM_AOI_1.tif").write_bytes(b"tif" * 10)
    (scratch / "sub" / "dem.ascii").write_bytes(b"asc" * 5)

    run = _fake_steprun(tmp_path)
    manifest = storage.store_outputs(run, scratch)

    assert {m["name"] for m in manifest} == {"DEM_AOI_1.tif", "dem.ascii"}
    assert all(m["key"].startswith("reshma/4/2/dem/") for m in manifest)
    assert run.bytes_written == 45
    assert run.manifest == manifest

    staged = storage.stage_inputs([m["key"] for m in manifest], tmp_path / "stage")
    assert sorted(p.name for p in staged) == ["DEM_AOI_1.tif", "dem.ascii"]
    assert (tmp_path / "stage" / "dem.ascii").read_bytes() == b"asc" * 5


def test_presign_local_vs_s3(storage):
    key = build_key("reshma", 1, 1, "dem", "a.tif")
    storage.save(key, b"data")
    url = storage.presigned_url(key)
    if storage.supports_presign:
        assert "fimsim-test" in url and "Signature" in url or "X-Amz-Signature" in url
        put = storage.presigned_put_url(key)
        assert put and put != url
    else:
        assert url is None and storage.presigned_put_url(key) is None


# ── Live MinIO integration (fimeval precedent: moto is not MinIO) ───────────

@pytest.mark.skipif(
    not os.environ.get("FIMSIM_TEST_MINIO_ENDPOINT"),
    reason="set FIMSIM_TEST_MINIO_ENDPOINT/_KEY/_SECRET to run against live MinIO",
)
def test_live_minio_roundtrip_and_presign(tmp_path):
    import requests

    svc = make_s3_service(
        access_key=os.environ["FIMSIM_TEST_MINIO_KEY"],
        secret_key=os.environ["FIMSIM_TEST_MINIO_SECRET"],
        bucket=os.environ.get("FIMSIM_TEST_MINIO_BUCKET", "fimsim-test"),
        endpoint_url=os.environ["FIMSIM_TEST_MINIO_ENDPOINT"],
        ensure_bucket=True,
    )
    key = build_key("reshma", 999, 1, "dem", "integration.bin")
    payload = os.urandom(256 * 1024)
    svc.save(key, payload)
    try:
        assert svc.size(key) == len(payload)
        url = svc.presigned_url(key, expiry_seconds=120)
        assert requests.get(url, timeout=10).content == payload
        put_url = svc.presigned_put_url(
            build_key("reshma", 999, 1, "dem", "put.bin"), 120)
        assert requests.put(put_url, data=b"put-me", timeout=10).status_code in (200, 204)
        assert svc.size(build_key("reshma", 999, 1, "dem", "put.bin")) == 6
    finally:
        svc.delete(key)
        svc.delete(build_key("reshma", 999, 1, "dem", "put.bin"))
