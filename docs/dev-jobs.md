# Running FIMsim jobs locally (FIMSIM-BE5)

The app executes wizard steps as Tethys **DaskJobs** — one job per AOI — on
the scheduler linked to the app's `dask_primary` setting. Workers import
`fimcore` and the app package, write progress to the `StepRun` rows, and
upload outputs through the BE4 storage service.

## One-time setup

```bash
conda activate tethys
pip install -e ~/tethysdev/fimcore --no-deps   # engine (deps already in env)
pip install pynhd pygeoogc openpyxl             # fimcore deps not in base env

# register the local scheduler and link it to the app
tethys schedulers create-dask -n dask_local -e tcp://127.0.0.1:8786 -t 3600 -b 5 -d 127.0.0.1:8787
tethys link dask:dask_local fimsim_gui:ss_scheduler:dask_primary
```

## Each dev session

```bash
# terminal 1 — scheduler
conda activate tethys && dask scheduler --port 8786 --dashboard-address :8787

# terminal 2 — workers (2 procs × 1 thread ≈ two concurrent AOIs)
# 5GB per worker is the working floor: the geospatial import baseline +
# GDAL caches alone crashlooped a 3GB nanny budget (kill → dask reschedules
# → kill again, while the StepRun sits "running" forever).
conda activate tethys && dask worker tcp://127.0.0.1:8786 --nworkers 2 --nthreads 1 --memory-limit 5GB

# terminal 3 — portal
conda activate tethys && tethys manage start
```

Dashboard: http://127.0.0.1:8787

## Smoke-test the pipeline

```bash
tethys manage shell < scripts/dev_submit_dem.py
```

Creates a `BE5_Harness` project with two Neuse AOIs, submits a 90 m DEM job
per AOI, and polls the StepRun rows until both finish — you should see the
two jobs run concurrently on the dashboard, structured progress events land
on the rows, and the outputs manifest point at MinIO keys.

## How cancellation works

Cancel = set the StepRun's status to `cancelled` (BE6/BE7 expose this as an
endpoint). The worker's `log_fn` adapter re-reads the status at most every
2 s and raises inside the running fimcore call — the desktop's cooperative
`WorkerCancelled` pattern. Granularity is therefore only as fine as the
engine's log chatter; long silent stretches (a single huge raster op) won't
notice the cancel until they next log.

## Worker gotchas (learned the hard way)

- **PROJ**: the env mixes conda `proj` (for conda `gdal`) with pip
  `pyproj`/`rasterio` wheels. A `PROJ_DATA` / wheel mismatch makes every
  transform return `inf` — `run_step_job` sanity-checks a known transform at
  start and fails loudly with diagnostics instead of producing garbage.
- **Django**: workers have no `DJANGO_SETTINGS_MODULE`; the wrapper
  configures a minimal settings stub before django-storages is touched.
- **DB URL**: SQLAlchemy 1.4's `str(engine.url)` masks the password —
  the submit side renders it with `hide_password=False` for the worker.
- **Stale "running" rows**: if a worker dies before finalizing (OOM kill,
  machine reboot), its StepRun stays `running` with no new progress events.
  FE7 surfaces this as "no update for X min"; BE10 should add a reaper that
  fails runs whose last event is older than a threshold.

- **Restart dask after code changes**: the scheduler AND workers hold imported
  app modules in memory; a task referencing a function added since they
  started dies at deserialization ("Can't get attribute …") and the DB row
  never advances. Any edit to jobs.py / job_types → restart both.
