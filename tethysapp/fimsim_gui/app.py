from tethys_sdk.base import TethysAppBase
from tethys_sdk.app_settings import (
    CustomSetting, PersistentStoreDatabaseSetting, SchedulerSetting,
)


class App(TethysAppBase):
    """FIMsim GUI Tethys App."""

    name = 'FIMsim GUI'
    package = 'fimsim_gui'  # WARNING: Do not change this value
    root_url = 'fimsim-gui'
    index = 'home'
    catch_all = 'home'

    icon = f'{package}/images/android-chrome-512x512.png'
    description = (
        'Webapp GUI for FIMsim — browser-based setup and execution of 2D flood '
        'inundation simulations (LISFLOOD-FP MVP; TRITON, OWP HAND-FIM, and '
        'ARC-Curve2Flood to follow)'
    )
    color = '#1266a3'
    tags = 'FIM, Flood Mapping, Flood Inundation Mapping, Hydrology, Hydraulics, LISFLOOD-FP, GIS'
    enable_feedback = False
    feedback_emails = []

    def custom_settings(self):
        return (
            CustomSetting(
                name='minio_endpoint_url',
                type=CustomSetting.TYPE_STRING,
                description='MinIO/S3 endpoint URL (e.g. http://127.0.0.1:9000). '
                            'Leave blank for real AWS.',
                required=False,
            ),
            CustomSetting(
                name='s3_public_endpoint_url',
                type=CustomSetting.TYPE_STRING,
                description=(
                    'Browser-facing object-storage URL used for presigned upload/download '
                    'URLs. Leave blank to reuse the server storage endpoint (correct for '
                    'local dev); set in production when the browser reaches storage at a '
                    'different host than the server does.'
                ),
                required=False,
            ),
            CustomSetting(
                name='minio_access_key',
                type=CustomSetting.TYPE_STRING,
                description='MinIO/S3 access key',
                required=True,
            ),
            CustomSetting(
                name='minio_secret_key',
                type=CustomSetting.TYPE_STRING,
                description='MinIO/S3 secret key',
                required=True,
            ),
            CustomSetting(
                name='s3_bucket',
                type=CustomSetting.TYPE_STRING,
                description='S3/MinIO bucket name (e.g. fimsim)',
                required=True,
            ),
            CustomSetting(
                name='max_dem_cells',
                type=CustomSetting.TYPE_INTEGER,
                description='Max predicted DEM grid cells per AOI (default 150,000,000).',
                required=False,
            ),
            CustomSetting(
                name='max_concurrent_jobs',
                type=CustomSetting.TYPE_INTEGER,
                description='Max active jobs per user (default 4).',
                required=False,
            ),
            CustomSetting(
                name='storage_quota_gb',
                type=CustomSetting.TYPE_FLOAT,
                description='Per-user storage quota in GB (default 5).',
                required=False,
            ),
            CustomSetting(
                name='retention_days',
                type=CustomSetting.TYPE_INTEGER,
                description='Days to keep run artifacts before cleanup (default 30).',
                required=False,
            ),
            CustomSetting(
                name='max_aoi_area_km2',
                type=CustomSetting.TYPE_FLOAT,
                description='Maximum AOI area in km² (default 1000 — group decision pending).',
                required=False,
            ),
            CustomSetting(
                name='lisflood_binary_path',
                type=CustomSetting.TYPE_STRING,
                description='Path to the LISFLOOD-FP executable on the workers.',
                required=False,
            ),
            CustomSetting(
                name='local_storage_path',
                type=CustomSetting.TYPE_STRING,
                description=(
                    'Dev toggle: store files in this local directory instead of '
                    'MinIO/S3. Leave blank in production.'
                ),
                required=False,
            ),
        )

    def persistent_store_settings(self):
        return (
            PersistentStoreDatabaseSetting(
                name='primary_db',
                description='Projects, AOIs, StepRuns + HUC/state reference layers',
                initializer='fimsim_gui.models.init_primary_db',
                required=True,
                spatial=True,
            ),
        )

    def scheduler_settings(self):
        return (
            SchedulerSetting(
                name='dask_primary',
                description='Primary Dask scheduler for async FIMsim jobs',
                engine=SchedulerSetting.DASK,
                required=False,
            ),
        )
