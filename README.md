# tethysapp-fimsim-gui

Webapp GUI for **FIMsim** — browser-based setup and execution of 2D flood
inundation simulations, with no local Python environment, GIS stack, or model
installation required.

Users define a project and an Area of Interest (upload a shapefile/GeoPackage or
draw on a map); FIMsim downloads and processes every required input (DEM, land
cover / Manning's n, flowlines, streamflow), writes all model configuration
files, submits the simulation to the compute backend, and displays the
resulting flood map.

- **MVP:** LISFLOOD-FP pipeline end-to-end, including server-side execution (CPU).
- **Post-MVP:** TRITON (GPU), OWP HAND-FIM, ARC-Curve2Flood, standalone
  input-prep tools.

Part of the FIM ecosystem on the CIROH Tethys portal, alongside
[FIMeval GUI](https://github.com/Aquaveo/tethysapp-fimeval-gui) and FIMBench GUI.
The desktop counterpart is [FIMsim](https://github.com/pnikrou/FIMsim) by
Parvaneh Nikrou; the simulation/data-prep engine is shared via the `fimcore`
package extracted from that repo.

## Architecture

- **Tethys 4** (Django) backend serving a **React/TypeScript SPA** (Vite) at
  `/apps/fimsim-gui/` with a catch-all home controller for client-side routing.
- Async jobs via Tethys **DaskJob** on a Dask Distributed cluster — one job per
  AOI, fanned out for multi-AOI projects.
- Files handled through **django-storages**: local directories in dev,
  MinIO/AWS S3 in the cloud, one code path. Per-user key isolation
  (`<user_id>/<project_id>/<aoi_id>/`).

## Development

```bash
conda activate tethys
pip install -e .
tethys install -d
tethys manage start
```

The React SPA lives in `reactapp/` (coming with FIMSIM-FE1); until it lands the
app serves the placeholder Django template.
