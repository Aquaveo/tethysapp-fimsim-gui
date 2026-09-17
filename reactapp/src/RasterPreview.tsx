// reactapp/src/RasterPreview.tsx
// Visuals plan Phase 2 — per-step raster previews, desktop parity:
//  · Terrain: elevation overlay (desktop `terrain` ramp) + stats line
//  · Roughness/Friction: LULC ⇄ Manning-n overlay toggle + the land-cover
//    breakdown table (km², % area, n) computed the desktop's way (BE12)
// Artifacts come from the run's outputs manifest via the same-origin proxy.
import { useEffect, useState } from 'react';
import AoiMap, { type MapOverlay } from './AoiMap';
import type { ServerAoi, ServerStepRun } from './api';
import { fileProxyUrl } from './outputsMeta';
import './RasterPreview.css';

interface DemMeta {
  kind: 'dem';
  bounds: { west: number; south: number; east: number; north: number };
  stats: { min_m: number; max_m: number; mean_m: number; res_m: number;
    width_px: number; height_px: number; crs: string };
  legend: { ramp: string[]; vmin: number; vmax: number; label: string };
}

interface LulcMeta {
  kind: 'lulc';
  bounds: { west: number; south: number; east: number; north: number };
  classes: { code: number; name: string; color: string;
    area_km2: number; pct: number; n: number | null }[];
  has_manning: boolean;
}

type Meta = DemMeta | LulcMeta;

const toCorners = (b: Meta['bounds']): MapOverlay['coordinates'] => [
  [b.west, b.north], [b.east, b.north], [b.east, b.south], [b.west, b.south],
];

export default function RasterPreview({ aoi, run, kind, defaultOpen }: {
  aoi: ServerAoi;
  run: ServerStepRun;
  kind: 'dem' | 'lulc';
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [failed, setFailed] = useState(false);
  const [layer, setLayer] = useState<'lulc' | 'manning'>('lulc');

  const metaName = kind === 'dem' ? 'preview_dem.json' : 'preview_lulc.json';
  const available = (Array.isArray(run.manifest) ? run.manifest : [])
    .some((m) => m.name === metaName);

  useEffect(() => {
    if (!open || !available || meta || failed) return;
    fetch(fileProxyUrl(run.id, metaName))
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(setMeta)
      .catch(() => setFailed(true));
  }, [open, available, meta, failed, run.id, metaName]);

  if (!available) return null; // older runs have no preview — table still works

  const png = kind === 'dem' ? 'preview_dem.png'
    : layer === 'manning' ? 'preview_manning.png' : 'preview_lulc.png';
  const overlay: MapOverlay[] = meta ? [{
    id: `rp-${run.id}-${png}`,
    url: fileProxyUrl(run.id, png),
    coordinates: toCorners(meta.bounds),
  }] : [];

  return (
    <details className="rp" open={open}
             onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary>{kind === 'dem' ? 'Terrain preview' : 'Land cover & roughness preview'}</summary>
      {open && (
        <div className="rp-body">
          {meta?.kind === 'dem' && (
            <p className="rp-stats">
              {meta.stats.width_px} × {meta.stats.height_px} px ·{' '}
              {meta.stats.res_m.toFixed(0)} m cells · {meta.stats.crs} ·
              elevation {meta.stats.min_m.toFixed(1)}–{meta.stats.max_m.toFixed(1)} m
              (mean {meta.stats.mean_m.toFixed(1)} m)
            </p>
          )}
          {meta?.kind === 'lulc' && meta.has_manning && (
            <div className="rp-toggle" role="group" aria-label="Layer">
              <button type="button"
                      className={layer === 'lulc' ? 'is-active' : ''}
                      onClick={() => setLayer('lulc')}>Land cover</button>
              <button type="button"
                      className={layer === 'manning' ? 'is-active' : ''}
                      onClick={() => setLayer('manning')}>Manning&apos;s n</button>
            </div>
          )}
          <AoiMap
            aois={[aoi]}
            drawing={false}
            onDrawComplete={() => undefined}
            onDrawCancel={() => undefined}
            overlays={overlay}
            overlayOpacity={0.75}
          />
          {meta?.kind === 'dem' && (
            <div className="rp-ramp" aria-label={meta.legend.label}>
              <span className="rp-ramp-bar" style={{
                background: `linear-gradient(to right, ${meta.legend.ramp.join(',')})`,
              }} />
              <span className="rp-ramp-ends">
                <span>{meta.legend.vmin.toFixed(0)} m</span>
                <span>{meta.legend.label}</span>
                <span>{meta.legend.vmax.toFixed(0)} m</span>
              </span>
            </div>
          )}
          {meta?.kind === 'lulc' && (
            <div className="rp-tablewrap">
              <table className="rp-table">
                <thead>
                  <tr><th></th><th>Class</th><th>Area (km²)</th><th>% area</th><th>Manning n</th></tr>
                </thead>
                <tbody>
                  {meta.classes.map((c) => (
                    <tr key={c.code}>
                      <td><i className="rp-sw" style={{ background: c.color }} /></td>
                      <td>{c.name}</td>
                      <td className="rp-num">{c.area_km2.toFixed(1)}</td>
                      <td className="rp-num">{c.pct.toFixed(1)}%</td>
                      <td className="rp-num">{c.n ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {failed && <p className="rp-hint">The preview could not be loaded.</p>}
        </div>
      )}
    </details>
  );
}
