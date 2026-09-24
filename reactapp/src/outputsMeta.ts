// reactapp/src/outputsMeta.ts
// Human descriptions for output files (Results table). Pattern-matched by
// filename; unknown files get a generic row rather than being hidden.
export interface OutputMeta {
  label: string;
  description: string;
}

/** Bytes → a short "12.3 MB" / "48 kB" label (matches the Results table). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 kB';
  return bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} kB`;
}

/** Count + total bytes of the rows whose key is in `selected`. */
export function summarizeSelection(
  rows: { key: string; bytes: number }[], selected: ReadonlySet<string>,
): { count: number; bytes: number } {
  let count = 0;
  let bytes = 0;
  for (const r of rows) {
    if (selected.has(r.key)) { count += 1; bytes += r.bytes; }
  }
  return { count, bytes };
}

/**
 * Keep only the step entries that belong to the active model. The Results view
 * for a deck-only model (TRITON) must not pick up a LISFLOOD `run` overlay or
 * list LISFLOOD files when both models have run against the same AOI.
 */
export function keepModelSteps<T>(
  entries: [string, T][], allowed: readonly string[],
): [string, T][] {
  const keep = new Set(allowed);
  return entries.filter(([step]) => keep.has(step));
}

const RULES: [RegExp, OutputMeta][] = [
  [/^max_depth\.tif$/i, {
    label: 'Flood map (GeoTIFF)',
    description: 'Maximum water depth over the whole event, georeferenced — open in QGIS/ArcGIS.',
  }],
  [/^max_depth\.ascii$/i, {
    label: 'Flood map (raw solver output)',
    description: "LISFLOOD-FP's own .max grid (ESRI ASCII) — the unprocessed source of the GeoTIFF.",
  }],
  [/^max_depth_overlay\.png$/i, {
    label: 'Map overlay image',
    description: 'The blue flood layer drawn on the map above (color-ramped by depth).',
  }],
  [/^overlay_bounds\.json$/i, {
    label: 'Overlay bounds & stats',
    description: 'Geographic extent of the overlay plus max depth / wet-area statistics.',
  }],
  [/\.mass$/i, {
    label: 'Mass balance log',
    description: "The solver's volume-conservation record over time — the standard sanity check of a run.",
  }],
  [/^depth_snapshots\.zip$/i, {
    label: 'Depth time series (zip)',
    description: 'Every saved water-depth grid through the event — for animations or time-step analysis.',
  }],
  [/^DEM_.*\.tif$/i, {
    label: 'Elevation model (GeoTIFF)',
    description: 'The downloaded terrain, reprojected to the working CRS at your chosen resolution.',
  }],
  [/^dem\.ascii$/i, {
    label: 'Elevation grid (model input)',
    description: "The terrain in LISFLOOD-FP's ASCII grid format — the deck's DEMfile.",
  }],
  [/^lulc\.ascii$/i, {
    label: "Manning's n grid (model input)",
    description: "Roughness per cell derived from land cover — the deck's manningfile.",
  }],
  [/^(LULC|lulc).*\.tif$/i, {
    label: 'Land cover (GeoTIFF)',
    description: 'The downloaded land-cover classification used to derive roughness.',
  }],
  [/^ManningN.*\.tif$/i, {
    label: "Manning's n (GeoTIFF)",
    description: 'The roughness raster, viewable in GIS.',
  }],
  [/\.prj$/i, {
    label: 'Projection file',
    description: 'Coordinate reference system definition accompanying the ASCII grids.',
  }],
  [/\.bci$/i, {
    label: 'Boundary conditions (model input)',
    description: 'Where water enters (upstream inflow) and leaves (downstream boundary) the domain.',
  }],
  [/\.bdy$/i, {
    label: 'Inflow time series (model input)',
    description: "The event hydrograph as the solver consumes it — per metre of cell width.",
  }],
  [/discharge.*\.csv$/i, {
    label: 'Discharge time series (CSV)',
    description: 'The raw streamflow record (m³/s) fetched from the NWM or USGS — the hydrograph chart plots this.',
  }],
  [/\.par$/i, {
    label: 'Solver configuration (model input)',
    description: 'LISFLOOD-FP run settings — with the rest of the deck, this re-runs the simulation anywhere.',
  }],
  [/flowline|\.shp$|\.gpkg$/i, {
    label: 'River network',
    description: 'NHD flowlines clipped to the study area.',
  }],
];

/** First matching rule wins; unknown names get a generic row, never hidden. */
export function outputMeta(name: string): OutputMeta {
  for (const [re, meta] of RULES) {
    if (re.test(name)) return meta;
  }
  return { label: name, description: 'Additional output from this step.' };
}

/** Same-origin file proxy (MinIO presigned URLs are CORS-blocked for fetch/
 *  MapLibre). Trailing slash required (Django); ?dl=1 forces attachment. */
export const fileProxyUrl = (runId: number, name: string, download = false) =>
  `/apps/fimsim-gui/api/stepruns/${runId}/file/${encodeURIComponent(name)}/`
  + (download ? '?dl=1' : '');

/** "Download all" zip of every stored output for one AOI. */
export const aoiZipUrl = (aoiId: number) => `/apps/fimsim-gui/api/aois/${aoiId}/zip/`;
