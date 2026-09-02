// reactapp/src/Docs.tsx
// FIMSIM-FE13: in-app documentation, adapted from the desktop FIMsim manual
// (manual_site, © Parvaneh Nikrou), the repo README, the bundled test-case
// tutorials, and the parameter defaults in the shared fimcore engine. The
// AOI-drawing guidance is her hydrology expertise, lightly edited for the
// web wizard.
import { useEffect, useState } from 'react';
import './Docs.css';

const SECTIONS = [
  ['overview', 'Overview'],
  ['aoi', 'Drawing a good study area'],
  ['steps', 'The wizard, step by step'],
  ['data', 'Data sources'],
  ['formats', 'Output files & formats'],
  ['tutorial', 'Tutorial: Hurricane Matthew'],
  ['trouble', 'Troubleshooting'],
  ['limits', 'Limits & fair use'],
  ['credits', 'Credits & the full manual'],
] as const;

export default function Docs() {
  const [cap, setCap] = useState<string>('1,000');
  useEffect(() => {
    fetch('/apps/fimsim-gui/api/limits/')
      .then((r) => r.json())
      .then((l) => setCap(Math.round(l.max_aoi_area_km2).toLocaleString()))
      .catch(() => undefined);
  }, []);

  return (
    <div className="dc-wrap">
      <nav className="dc-toc" aria-label="Contents">
        {SECTIONS.map(([id, label]) => (
          <a key={id} href={`#${id}`}>{label}</a>
        ))}
      </nav>

      <article className="dc-body">
        <section id="overview">
          <h2>Overview</h2>
          <p>
            FIMsim is part of the CIROH Flood Inundation Mapping ecosystem — a
            tool that makes hydraulic flood modeling accessible, fast, and
            user-friendly. It lets you prepare model-ready input data and run
            flood simulations without installing modeling software, configuring
            technical computing environments, or owning high-performance
            hardware.
          </p>
          <p>
            You define a study area; FIMsim downloads every input the model
            needs — terrain (USGS 3DEP), land cover and Manning&apos;s
            roughness (NLCD / Esri Sentinel-2), the river network (NHD), and
            streamflow (National Water Model or USGS gages) — writes the
            LISFLOOD-FP configuration, runs the simulation on the portal&apos;s
            compute cluster, and maps the flood.
          </p>
          <img
            className="dc-diagram"
            src="/static/fimsim_gui/images/FIMsim_workflow.png"
            alt="FIMsim workflow: AOI → data preparation → model files → simulation → flood map"
          />
        </section>

        <section id="aoi">
          <h2>Drawing a good study area</h2>
          <p>
            LISFLOOD-FP needs to know <strong>where water enters and
            leaves</strong> the domain. FIMsim finds those locations
            automatically at the points where the river crosses your study
            area&apos;s edges: the upstream inflow where the river{' '}
            <em>enters</em>, the downstream outflow where it <em>exits</em>.
            An inaccurate edge therefore produces an inaccurate boundary
            condition — the most common cause of a simulation that doesn&apos;t
            represent the real flow path. If the river only clips a corner,
            runs parallel to an edge, or exits through a ragged edge, the
            inflow and outflow can land in the wrong place.
          </p>
          <ul>
            <li>
              <strong>Let the river cross the edges cleanly.</strong> The main
              river should enter through one edge and leave through another,
              ideally close to perpendicular.
            </li>
            <li>
              <strong>Keep the river away from corners.</strong> A corner
              crossing leaves most of the domain unused and makes the boundary
              point ambiguous.
            </li>
            <li>
              <strong>Cover the full study reach</strong>, including the
              floodplain on both banks, so the inundation isn&apos;t cut off by
              the domain edge. When no single high-order river spans the
              domain, FIMsim uses the longest river covering the study area.
            </li>
            <li>
              <strong>One clean rectangle per domain.</strong> The web app
              enforces this: draw any shape and it closes into its enclosing
              rectangle (the model&apos;s mesh is strictly rectangular).
            </li>
            <li>
              <strong>Match a sensible resolution.</strong> A large domain at a
              fine cell size produces very large grids and long run times —
              10 m is the recommended baseline.
            </li>
          </ul>
          <p className="dc-tip">
            After the Area of Interest step, check the map: the detected main
            river (dark line) should truly enter and leave your rectangle where
            you expect. If it doesn&apos;t, fix the area now rather than after
            the model is built.
          </p>
        </section>

        <section id="steps">
          <h2>The wizard, step by step</h2>

          <h3>1 · Project</h3>
          <p>
            Everything (areas, inputs, results) is stored under a project;
            reopen it any time from the Simulations list. Re-running a step
            supersedes that step&apos;s previous outputs and everything
            downstream of it.
          </p>

          <h3>2 · Area of Interest</h3>
          <p>
            Upload a zipped shapefile, GeoPackage, or GeoJSON, or draw on the
            map. Each polygon feature becomes its own study area (its own model
            domain, its own results). FIMsim resolves the state, HUC
            watersheds, the main river, and nearby USGS gages automatically.
            All rasters are reprojected into a metric UTM coordinate system
            picked from your area&apos;s location, so &ldquo;10 m cell
            size&rdquo; really means 10 metres on the ground.
          </p>

          <h3>3 · Terrain</h3>
          <p>
            Downloads elevation and grids it for the model
            (<code>dem.ascii</code>). Sources: <strong>USGS 3DEP</strong>{' '}
            (standard elevation; 10 m is the baseline product) or{' '}
            <strong>TACC HAND</strong> (height above nearest drainage). Finer
            resolutions (1 m / 3 m) increase download sizes and simulation
            times substantially; 30 m / 90 m are useful for fast previews.
          </p>

          <h3>4 · Roughness</h3>
          <p>
            Builds the Manning&apos;s n friction grid
            (<code>lulc.ascii</code>). <strong>Varying</strong> mode downloads
            land cover — <strong>NLCD</strong> (USA, 30 m, matches US studies
            best) or <strong>Esri Sentinel-2</strong> (global, 10 m) — and
            assigns a roughness value per land-cover class. The table is
            editable: defaults come from published hydraulic literature
            (Chow, 1959), and edits are clamped to each class&apos;s
            literature min/max. <strong>Fixed</strong> mode applies a single
            value everywhere — use it for simple simulations or when land-cover
            variability is not critical.
          </p>

          <h3>5 · Boundaries</h3>
          <p>
            Detects where the main river crosses your edges and writes the
            boundary conditions (<code>.bci</code>). Upstream: time-varying
            discharge (from the Flow Data step) or a fixed discharge; the
            inflow point is nudged ~100 m inside the domain so it sits safely
            on the grid. Downstream: <strong>free outflow</strong> (normal
            depth with a bed slope, default 0.0001) or a{' '}
            <strong>fixed water level</strong>.
          </p>

          <h3>6 · Flow Data</h3>
          <p>
            Pulls the event hydrograph for your window (<code>.bdy</code> plus
            the raw discharge CSV in m³/s). Sources:
          </p>
          <div className="dc-tablewrap">
            <table className="dc-table">
              <thead>
                <tr><th>Source</th><th>Coverage</th><th>Notes</th></tr>
              </thead>
              <tbody>
                <tr>
                  <td>NWM Retrospective (v3.0)</td>
                  <td>Feb 1979 – Jan 2023, USA</td>
                  <td>Uses the NWM feature ID detected for your main river.</td>
                </tr>
                <tr>
                  <td>NWM Forecast</td>
                  <td>~10-day horizon</td>
                  <td>Operational forecast; no long historical archive.</td>
                </tr>
                <tr>
                  <td>USGS gage</td>
                  <td>Gage&apos;s period of record</td>
                  <td>15-minute readings are resampled to your interval;
                      detected gages are listed on the AOI cards.</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p>
            FIMsim warns if the fetched record has gaps larger than 1.5× your
            interval or covers less of the window than expected.
          </p>

          <h3>7 · Settings</h3>
          <p>
            Writes the LISFLOOD-FP control file (<code>model.par</code>).
            Solvers: <strong>Acceleration</strong> (recommended for most
            cases), <strong>Adaptive timestep</strong>, or{' '}
            <strong>Diffusion</strong> (simple, slow shallow flows). Key
            defaults: dry start, initial timestep 1 s, output interval
            3600 s; the simulation length is derived from your flow data&apos;s
            full window unless you set it explicitly.
          </p>

          <h3>8 · Run</h3>
          <p>
            Executes LISFLOOD-FP on the compute cluster with live progress;
            each study area runs as its own job, cancellable at any time. A
            time limit stops runaway runs. Optionally keep every saved depth
            snapshot (one grid per output interval) as a zip — useful for
            animations, but large.
          </p>

          <h3>9 · Results</h3>
          <p>
            The flood map drapes over the study area with max-depth and
            wet-area statistics, the event hydrograph replays below it, and
            every generated file is listed with a description and download
            button — including the complete model input deck if you want to
            re-run or modify the simulation on your own machine
            (<code>lisflood -v model.par</code>).
          </p>
        </section>

        <section id="data">
          <h2>Data sources</h2>
          <div className="dc-tablewrap">
            <table className="dc-table">
              <thead>
                <tr><th>Dataset</th><th>Provider</th><th>Coverage</th></tr>
              </thead>
              <tbody>
                <tr><td>Elevation (DEM)</td><td>USGS 3DEP</td><td>USA · 1 m – 90 m</td></tr>
                <tr><td>HAND</td><td>TACC</td><td>USA</td></tr>
                <tr><td>Land cover</td><td>NLCD — USGS</td><td>USA · 30 m</td></tr>
                <tr><td>Land cover</td><td>Sentinel-2 — Esri</td><td>Global · 10 m</td></tr>
                <tr><td>River flowlines</td><td>NHD — USGS</td><td>USA</td></tr>
                <tr><td>Stream gages</td><td>USGS Water Services</td><td>USA</td></tr>
                <tr><td>Streamflow (historic)</td><td>NWM Retrospective v3.0 — NOAA</td><td>USA · 1979–2023</td></tr>
                <tr><td>Streamflow (forecast)</td><td>NWM Operational — NOAA</td><td>USA · ~10-day horizon</td></tr>
              </tbody>
            </table>
          </div>
        </section>

        <section id="formats">
          <h2>Output files &amp; formats</h2>
          <ul>
            <li>
              <strong><code>max_depth.tif</code></strong> — the flood map:
              maximum water depth over the whole event, georeferenced (open in
              QGIS/ArcGIS). <code>max_depth.ascii</code> is the raw solver
              grid it was made from.
            </li>
            <li>
              <strong><code>res.mass</code></strong> — the solver&apos;s
              volume-conservation record over time, the standard sanity check
              of a run.
            </li>
            <li>
              <strong><code>.bci</code></strong> — boundary locations: a{' '}
              <code>P</code> point line for the upstream inflow
              (<code>QVAR</code> time-varying / <code>QFIX</code> fixed) and an{' '}
              <code>S</code> edge line for the downstream boundary
              (<code>FREE</code> slope / <code>HFIX</code> level).
            </li>
            <li>
              <strong><code>.bdy</code></strong> — the inflow series as the
              solver consumes it. Note the units: LISFLOOD-FP takes inflow{' '}
              <em>per metre of cell width</em> (m²/s), so these values are the
              real discharge divided by the grid cell size. The raw discharge
              CSV (m³/s) is shipped alongside — that&apos;s what the hydrograph
              chart plots.
            </li>
            <li>
              <strong><code>model.par</code></strong> — the run settings; with
              the rest of the deck, this re-runs the simulation anywhere
              LISFLOOD-FP is installed.
            </li>
          </ul>
        </section>

        <section id="tutorial">
          <h2>Tutorial: Hurricane Matthew on the Neuse River</h2>
          <p>
            The desktop FIMsim&apos;s canonical test case, straight through the
            web wizard (~10 minutes at the 10 m baseline, faster at 30 m):
          </p>
          <ol className="dc-steps">
            <li>
              <strong>Project</strong> — create{' '}
              <code>Neuse_Hurricane_Matthew</code>.
            </li>
            <li>
              <strong>Area of Interest</strong> — draw a rectangle over the
              Neuse River near Goldsboro, NC (south-east of Raleigh). The
              lookup should detect the Neuse as the main river and USGS gage
              02089000 nearby.
            </li>
            <li>
              <strong>Terrain → Roughness → Boundaries</strong> — defaults
              throughout (3DEP terrain, NLCD land cover, time-varying upstream
              inflow, free downstream outflow).
            </li>
            <li>
              <strong>Flow Data</strong> — NWM retrospective,{' '}
              <code>2016-10-05</code> to <code>2016-10-20</code>, 1-hour
              interval. The hydrograph should rise around Oct 9 and peak at
              about <strong>1,630 m³/s</strong> near Oct 10–13.
            </li>
            <li>
              <strong>Settings → Run</strong> — defaults (Acceleration
              solver). Watch the live progress; then open{' '}
              <strong>Results</strong> for the flood map, depth statistics, and
              downloads.
            </li>
          </ol>
        </section>

        <section id="trouble">
          <h2>Troubleshooting</h2>
          <ul>
            <li>
              <strong>A download step fails or times out.</strong> USGS and
              NOAA services occasionally have outages — just re-run the step.
            </li>
            <li>
              <strong>No flow data for my dates.</strong> The NWM retrospective
              covers Feb 1979 – Jan 2023; for more recent events use a USGS
              gage. A gage record that starts later than your window is
              trimmed, not an error.
            </li>
            <li>
              <strong>&ldquo;The job system may be restarting.&rdquo;</strong>{' '}
              Submissions are briefly rejected while the compute cluster
              restarts; wait a moment and submit again.
            </li>
            <li>
              <strong>A step is rejected as too large.</strong> The grid-size
              guard estimates the run before starting it — reduce the area or
              choose a coarser resolution.
            </li>
            <li>
              <strong>Old outputs disappeared after a re-run.</strong>{' '}
              Re-running a step supersedes its previous outputs and everything
              downstream, so the deck always stays consistent.
            </li>
          </ul>
        </section>

        <section id="limits">
          <h2>Limits &amp; fair use</h2>
          <ul>
            <li>Study areas are capped at <strong>{cap} km²</strong> — larger case studies are better served by the desktop FIMsim.</li>
            <li>Data sources are US-only (CONUS): 3DEP, NHD, NLCD, and the National Water Model.</li>
            <li>10 m elevation is the baseline; 1 m / 3 m increase simulation times substantially.</li>
            <li>Uploaded files need a coordinate reference system; files without one are assumed WGS84 only when their coordinates look like degrees.</li>
            <li>This is a shared portal: concurrent jobs per user and total stored results are limited, and results are cleaned up after an extended period — download anything you want to keep.</li>
          </ul>
        </section>

        <section id="credits">
          <h2>Credits &amp; the full manual</h2>
          <p>
            FIMsim was created by <strong>Parvaneh Nikrou</strong> at the
            University of Alabama&apos;s Surface Dynamics Modeling Lab; this
            web app shares its engine with the{' '}
            <a href="https://github.com/pnikrou/FIMsim" target="_blank" rel="noreferrer">
              desktop FIMsim
            </a>, whose full user manual (with step-by-step screenshots) ships
            in the repository. The desktop app additionally covers TRITON,
            OWP HAND-FIM (built on Supath Dhital&apos;s fimserve), and
            ARC-Curve2Flood, plus four standalone data-download tools. Part of
            the{' '}
            <a href="https://sdml.ua.edu/" target="_blank" rel="noreferrer">
              FIM ecosystem
            </a>{' '}
            (CIROH · University of Alabama · SDML · BYU · Aquaveo).
          </p>
        </section>
      </article>
    </div>
  );
}
