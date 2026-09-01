// reactapp/src/Docs.tsx
// FIMSIM-FE13: in-app documentation, adapted from the desktop FIMsim manual
// (manual_site, © Parvaneh Nikrou) and the repo README — the AOI-drawing
// guidance is her hydrology expertise, lightly edited for the web wizard.
import { useEffect, useState } from 'react';
import './Docs.css';

const SECTIONS = [
  ['overview', 'Overview'],
  ['aoi', 'Drawing a good study area'],
  ['steps', 'The wizard, step by step'],
  ['limits', 'Limits'],
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
            FIMsim removes the technical barrier to setting up a 2D flood
            simulation. You define a study area; FIMsim downloads every input
            the model needs — terrain (USGS 3DEP), land cover and Manning&apos;s
            roughness (Esri Sentinel-2 / NLCD), the river network (NHD), and
            streamflow (National Water Model or USGS gages) — writes the
            LISFLOOD-FP configuration, runs the simulation, and maps the flood.
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
            Both LISFLOOD-FP and TRITON need to know <strong>where water
            enters and leaves</strong> the domain. FIMsim finds those locations
            automatically at the points where the river crosses your study
            area&apos;s edges: the upstream inflow where the river{' '}
            <em>enters</em>, the downstream outflow where it <em>exits</em>.
            An inaccurate edge therefore produces an inaccurate boundary
            condition — the most common cause of a simulation that doesn&apos;t
            represent the real flow path.
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
              the domain edge.
            </li>
            <li>
              <strong>One clean rectangle per domain.</strong> The web app
              enforces this: draw any shape and it closes into its enclosing
              rectangle (the models&apos; meshes are strictly rectangular).
            </li>
            <li>
              <strong>Match a sensible resolution.</strong> A large domain at a
              fine cell size produces very large grids and long run times —
              10 m is the recommended baseline.
            </li>
          </ul>
        </section>

        <section id="steps">
          <h2>The wizard, step by step</h2>
          <ol className="dc-steps">
            <li><strong>Project</strong> — everything (areas, inputs, results) is stored under it; reopen from the Simulations list.</li>
            <li><strong>Area of Interest</strong> — upload a zipped shapefile, GeoPackage, or GeoJSON, or draw on the map. Each polygon feature becomes its own study area; FIMsim resolves the state, HUC watersheds, the main river, and nearby USGS gages automatically.</li>
            <li><strong>Terrain</strong> — downloads USGS 3DEP elevation at your chosen resolution and grids it for the model (<code>dem.ascii</code>).</li>
            <li><strong>Roughness</strong> — fetches land cover and converts it to a Manning&apos;s n grid (<code>lulc.ascii</code>), or applies a single fixed value.</li>
            <li><strong>Boundaries</strong> — detects where the main river crosses your edges and writes the boundary conditions (<code>.bci</code>).</li>
            <li><strong>Flow Data</strong> — pulls the event hydrograph (NWM retrospective/forecast or a USGS gage) for your event window (<code>.bdy</code>).</li>
            <li><strong>Settings</strong> — LISFLOOD-FP solver options with sensible defaults (<code>model.par</code>); simulation length comes from your event window.</li>
            <li><strong>Run</strong> — executes LISFLOOD-FP on the compute cluster with live progress; each study area runs as its own job.</li>
            <li><strong>Results</strong> — the flood map drapes over the study area with max-depth and wet-area statistics; every generated file is downloadable, including the complete model input deck if you want to re-run or modify the simulation yourself.</li>
          </ol>
        </section>

        <section id="limits">
          <h2>Limits</h2>
          <ul>
            <li>Study areas are capped at <strong>{cap} km²</strong> — larger case studies are better served by the desktop FIMsim.</li>
            <li>Data sources are US-only (CONUS): 3DEP, NHD, NLCD, and the National Water Model.</li>
            <li>10 m elevation is the baseline; 1 m / 3 m increase simulation times substantially.</li>
            <li>Uploaded files need a coordinate reference system; files without one are assumed WGS84 only when their coordinates look like degrees.</li>
          </ul>
        </section>

        <section id="credits">
          <h2>Credits &amp; the full manual</h2>
          <p>
            FIMsim was created by <strong>Parvaneh Nikrou</strong>; this web
            app shares its engine with the{' '}
            <a href="https://github.com/pnikrou/FIMsim" target="_blank" rel="noreferrer">
              desktop FIMsim
            </a>, whose full user manual (with step-by-step screenshots and
            TRITON / standalone-tool workflows) ships in the repository. The
            OWP HAND-FIM workflow builds on Supath Dhital&apos;s fimserve.
            Part of the{' '}
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
