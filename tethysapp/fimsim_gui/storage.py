"""FIMSIM-BE4: file storage through django-storages, one code path everywhere.

Local filesystem in dev, MinIO/AWS S3 in the cloud — chosen purely by the
app's settings (boss directive; pattern proven on fimserve). All artifact
reads/writes go through this service; StepRun manifests store storage KEYS,
never absolute paths.

Key scheme (enforced — nothing hand-assembles keys):
    <username>/<project_id>/<aoi_id>/<step>/<filename>

Presigned URLs exist only on the S3 backend (the local backend returns None;
callers fall back to streaming through Django). Browser-facing presigns honor
the s3_public_endpoint_url setting for split-horizon deployments where the
browser reaches storage at a different host than the server does.
"""
import logging
import mimetypes
import re
from pathlib import Path, PurePosixPath

logger = logging.getLogger(__name__)

_FILENAME_SAFE = re.compile(r"[^A-Za-z0-9._\-]+")


class StorageKeyError(PermissionError):
    """A key fell outside the requesting user's prefix, or was malformed."""


#: Cross-user cache namespace (BE11). Deliberately outside every user prefix:
#: assert_owned() can never bless it, so user-facing endpoints can't presign
#: or delete cache objects — only job/maintenance code touches it.
SHARED_CACHE_PREFIX = "_shared_cache"


def shared_cache_key(dataset: str, filename: str) -> str:
    if not re.fullmatch(r"[a-z0-9_\-]{1,32}", dataset):
        raise StorageKeyError(f"invalid cache dataset: {dataset!r}")
    return f"{SHARED_CACHE_PREFIX}/{dataset}/{safe_filename(filename)}"


# ── Key helpers ───────────────────────────────────────────────────────────────

def safe_filename(name: str) -> str:
    name = PurePosixPath(str(name)).name          # strip any path components
    name = _FILENAME_SAFE.sub("_", name).strip("._")
    if not name:
        raise StorageKeyError("empty or fully-sanitized filename")
    return name


def user_prefix(username: str) -> str:
    u = _FILENAME_SAFE.sub("_", str(username)).strip("._")
    if not u:
        raise StorageKeyError("invalid username for key prefix")
    return u


def build_key(username: str, project_id: int, aoi_id=None, step=None,
              filename=None) -> str:
    parts = [user_prefix(username), str(int(project_id))]
    if aoi_id is not None:
        parts.append(str(int(aoi_id)))
    if step is not None:
        if not re.fullmatch(r"[a-z_][a-z0-9_-]{0,31}", str(step)):
            raise StorageKeyError(f"invalid step segment: {step!r}")
        parts.append(str(step))
    if filename is not None:
        parts.append(safe_filename(filename))
    return "/".join(parts)


def assert_owned(key: str, username: str) -> str:
    """Raise unless *key* sits inside *username*'s prefix. Returns the key."""
    key = str(key)
    if key.startswith("/") or ".." in key.split("/"):
        raise StorageKeyError(f"malformed key: {key!r}")
    if not key.startswith(user_prefix(username) + "/"):
        raise StorageKeyError("key is outside the requesting user's prefix")
    return key


# ── The service ───────────────────────────────────────────────────────────────

class StorageService:
    """One interface over django-storages backends.

    Construct directly for tests; use :func:`get_storage` at request time.
    """

    def __init__(self, backend, *, bucket=None, s3_client=None,
                 public_s3_client=None):
        self._backend = backend
        self._bucket = bucket
        self._client = s3_client                 # server-side ops / presign
        self._public_client = public_s3_client or s3_client  # browser presign

    # -- basic ops (all backends) --
    def save(self, key: str, content) -> str:
        """content: bytes or a file-like object. Returns the stored key."""
        from django.core.files.base import ContentFile, File
        if isinstance(content, (bytes, bytearray)):
            f = ContentFile(bytes(content))
        else:
            f = File(content)
        # django-storages may mangle names on collision; our keys are exact,
        # so delete-then-save keeps them stable.
        if self._backend.exists(key):
            self._backend.delete(key)
        stored = self._backend.save(key, f)
        return stored

    def open(self, key: str):
        return self._backend.open(key, "rb")

    def exists(self, key: str) -> bool:
        return self._backend.exists(key)

    def delete(self, key: str) -> None:
        if self._backend.exists(key):
            self._backend.delete(key)

    def size(self, key: str) -> int:
        return self._backend.size(key)

    def modified_time(self, key: str):
        """Timezone-aware mtime (eviction ordering); None if unavailable."""
        try:
            return self._backend.get_modified_time(key)
        except Exception:
            return None

    def download_to_path(self, key: str, dest_path) -> None:
        dest_path = Path(dest_path)
        dest_path.parent.mkdir(parents=True, exist_ok=True)
        with self.open(key) as src, open(dest_path, "wb") as dst:
            while True:
                chunk = src.read(1024 * 1024)
                if not chunk:
                    break
                dst.write(chunk)

    def list_prefix_with_sizes(self, prefix: str) -> list:
        """[(key, bytes)] under prefix — works on both backends."""
        results = []
        try:
            dirs, files = self._backend.listdir(prefix)
        except (FileNotFoundError, NotADirectoryError):
            return results
        for f in files:
            k = f"{prefix.rstrip('/')}/{f}"
            results.append((k, self._backend.size(k)))
        for d in dirs:
            results.extend(self.list_prefix_with_sizes(f"{prefix.rstrip('/')}/{d}"))
        return results

    def usage_bytes(self, username: str) -> int:
        return sum(b for _, b in self.list_prefix_with_sizes(user_prefix(username)))

    def delete_prefix(self, prefix: str) -> int:
        """Delete every object under prefix; returns the count removed.

        Deleting a Project/AOI row cascades in the DB but leaves its files
        behind (a single test project left 620 orphaned objects) — the DELETE
        endpoints call this so storage tracks the database.
        """
        n = 0
        for key, _size in self.list_prefix_with_sizes(prefix):
            try:
                self.delete(key)
                n += 1
            except Exception:  # a straggler must not fail the whole delete
                logger.warning("could not delete %s", key)
        return n

    # -- presign (S3 backends only; family method names per FIMeval) --
    @property
    def supports_presign(self) -> bool:
        return self._public_client is not None and self._bucket is not None

    def presigned_url(self, key: str, expiry_seconds: int = 3600):
        if not self.supports_presign:
            return None
        return self._public_client.generate_presigned_url(
            "get_object", Params={"Bucket": self._bucket, "Key": key},
            ExpiresIn=expiry_seconds,
        )

    def presigned_put_url(self, key: str, expiry_seconds: int = 3600):
        if not self.supports_presign:
            return None
        return self._public_client.generate_presigned_url(
            "put_object", Params={"Bucket": self._bucket, "Key": key},
            ExpiresIn=expiry_seconds,
        )

    # -- StepRun staging (the BE5 job wrapper's two calls) --
    def stage_inputs(self, keys, scratch_dir) -> list:
        """Pull storage keys into scratch_dir (flat, by filename). Returns paths."""
        scratch_dir = Path(scratch_dir)
        out = []
        for key in keys:
            dest = scratch_dir / PurePosixPath(key).name
            self.download_to_path(key, dest)
            out.append(dest)
        return out

    def store_outputs(self, step_run, scratch_dir, *, subdir=None) -> list:
        """Upload scratch_dir's files as the StepRun's outputs.

        Builds keys from the StepRun's aoi→project→username chain, writes the
        manifest ([{key,name,bytes,content_type}]) and bytes_written onto the
        StepRun (caller commits the session). Returns the manifest.
        """
        aoi = step_run.aoi
        project = aoi.project
        scratch_dir = Path(scratch_dir) if subdir is None else Path(scratch_dir) / subdir
        manifest, total = [], 0
        for path in sorted(p for p in scratch_dir.rglob("*") if p.is_file()):
            key = build_key(project.username, project.id, aoi.id,
                            step_run.step_key, path.name)
            with open(path, "rb") as fh:
                self.save(key, fh)
            n = path.stat().st_size
            manifest.append({
                "key": key,
                "name": path.name,
                "bytes": n,
                "content_type": mimetypes.guess_type(path.name)[0]
                or "application/octet-stream",
            })
            total += n
        step_run.manifest = manifest
        step_run.bytes_written = (step_run.bytes_written or 0) + total
        return manifest


# ── Factories ─────────────────────────────────────────────────────────────────

def make_local_service(root_dir) -> StorageService:
    from django.core.files.storage import FileSystemStorage
    root_dir = Path(root_dir)
    root_dir.mkdir(parents=True, exist_ok=True)
    return StorageService(FileSystemStorage(location=str(root_dir)))


def make_s3_service(*, access_key, secret_key, bucket, endpoint_url=None,
                    public_endpoint_url=None, ensure_bucket=False) -> StorageService:
    import boto3
    from storages.backends.s3boto3 import S3Boto3Storage

    backend = S3Boto3Storage(
        access_key=access_key,
        secret_key=secret_key,
        bucket_name=bucket,
        endpoint_url=endpoint_url or None,
        file_overwrite=True,
        querystring_auth=True,
    )
    common = dict(aws_access_key_id=access_key, aws_secret_access_key=secret_key)
    client = boto3.client("s3", endpoint_url=endpoint_url or None, **common)
    public_client = (
        boto3.client("s3", endpoint_url=public_endpoint_url, **common)
        if public_endpoint_url else client
    )
    if ensure_bucket:
        try:
            client.head_bucket(Bucket=bucket)
        except Exception:
            client.create_bucket(Bucket=bucket)
    return StorageService(backend, bucket=bucket, s3_client=client,
                          public_s3_client=public_client)


def storage_config_from_settings() -> dict:
    """The app's storage settings as a plain serializable dict — what the
    submit side hands to Dask workers (which must not touch App/django)."""
    from tethysapp.fimsim_gui.app import App
    local = App.get_custom_setting("local_storage_path")
    if local:
        return {"kind": "local", "root": str(local)}
    return {
        "kind": "s3",
        "access_key": App.get_custom_setting("minio_access_key"),
        "secret_key": App.get_custom_setting("minio_secret_key"),
        "bucket": App.get_custom_setting("s3_bucket"),
        "endpoint_url": App.get_custom_setting("minio_endpoint_url") or None,
        "public_endpoint_url": App.get_custom_setting("s3_public_endpoint_url") or None,
    }


def service_from_config(cfg: dict) -> StorageService:
    """Rebuild a StorageService from :func:`storage_config_from_settings`."""
    if cfg["kind"] == "local":
        return make_local_service(cfg["root"])
    return make_s3_service(
        access_key=cfg["access_key"], secret_key=cfg["secret_key"],
        bucket=cfg["bucket"], endpoint_url=cfg.get("endpoint_url"),
        public_endpoint_url=cfg.get("public_endpoint_url"), ensure_bucket=True,
    )


def get_storage() -> StorageService:
    """The app's configured storage: local dir if local_storage_path is set,
    else MinIO/S3 from the custom settings (blank endpoint = real AWS)."""
    from tethysapp.fimsim_gui.app import App
    local = App.get_custom_setting("local_storage_path")
    if local:
        return make_local_service(local)
    return make_s3_service(
        access_key=App.get_custom_setting("minio_access_key"),
        secret_key=App.get_custom_setting("minio_secret_key"),
        bucket=App.get_custom_setting("s3_bucket"),
        endpoint_url=App.get_custom_setting("minio_endpoint_url") or None,
        public_endpoint_url=App.get_custom_setting("s3_public_endpoint_url") or None,
        ensure_bucket=True,
    )
