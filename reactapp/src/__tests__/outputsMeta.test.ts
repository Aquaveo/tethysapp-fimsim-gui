// reactapp/src/__tests__/outputsMeta.test.ts — filename→description rules and
// the proxy/zip URL shapes (trailing slashes are load-bearing for Django).
import { describe, expect, it } from 'vitest';
import { aoiZipUrl, fileProxyUrl, outputMeta } from '../outputsMeta';

describe('outputMeta', () => {
  it('classifies the flood map GeoTIFF', () => {
    expect(outputMeta('max_depth.tif').label).toBe('Flood map (GeoTIFF)');
  });

  it('is case-insensitive', () => {
    expect(outputMeta('MAX_DEPTH.TIF').label).toBe('Flood map (GeoTIFF)');
  });

  it('classifies solver mass-balance logs by extension', () => {
    expect(outputMeta('res.mass').label).toBe('Mass balance log');
    expect(outputMeta('anything_else.mass').label).toBe('Mass balance log');
  });

  it('distinguishes the DEM GeoTIFF from the ASCII model input', () => {
    expect(outputMeta('DEM_10m.tif').label).toBe('Elevation model (GeoTIFF)');
    expect(outputMeta('dem.ascii').label).toBe('Elevation grid (model input)');
  });

  it('classifies deck files and the discharge CSV', () => {
    expect(outputMeta('model.par').label).toBe('Solver configuration (model input)');
    expect(outputMeta('neuse.bci').label).toBe('Boundary conditions (model input)');
    expect(outputMeta('neuse.bdy').label).toBe('Inflow time series (model input)');
    expect(outputMeta('discharge_nwm.csv').label).toBe('Discharge time series (CSV)');
  });

  it('falls back to a generic row for unknown files (name as label, never hidden)', () => {
    const meta = outputMeta('mystery.xyz');
    expect(meta.label).toBe('mystery.xyz');
    expect(meta.description).toBe('Additional output from this step.');
  });
});

describe('URL builders', () => {
  it('fileProxyUrl: app-rooted, trailing slash, no query by default', () => {
    expect(fileProxyUrl(12, 'max_depth.tif')).toBe(
      '/apps/fimsim-gui/api/stepruns/12/file/max_depth.tif/');
  });

  it('fileProxyUrl: ?dl=1 comes after the trailing slash when downloading', () => {
    expect(fileProxyUrl(12, 'max_depth.tif', true)).toBe(
      '/apps/fimsim-gui/api/stepruns/12/file/max_depth.tif/?dl=1');
  });

  it('fileProxyUrl: URL-encodes the filename', () => {
    expect(fileProxyUrl(3, 'a b/c.tif')).toBe(
      '/apps/fimsim-gui/api/stepruns/3/file/a%20b%2Fc.tif/');
  });

  it('aoiZipUrl: app-rooted with trailing slash', () => {
    expect(aoiZipUrl(7)).toBe('/apps/fimsim-gui/api/aois/7/zip/');
  });
});
