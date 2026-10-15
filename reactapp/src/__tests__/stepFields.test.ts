// reactapp/src/__tests__/stepFields.test.ts — consistency checks over the
// wizard's field specs so a typo in a key/showIf can't silently hide a field.
import { describe, expect, it } from 'vitest';
import { previewKind, STEP_FIELDS } from '../stepFields';
import { MODELS } from '../steps';

const entries = Object.entries(STEP_FIELDS);

describe('STEP_FIELDS consistency', () => {
  it('covers only real wizard steps', () => {
    const known = new Set(
      Object.values(MODELS).flatMap((m) => m.steps.map((s) => s.id)));
    const strays = entries.map(([step]) => step).filter((s) => !known.has(s as never));
    expect(strays).toEqual([]);
  });

  it('has unique field keys within each step', () => {
    const dupes: string[] = [];
    for (const [step, fields] of entries) {
      const seen = new Set<string>();
      for (const f of fields) {
        if (seen.has(f.key)) dupes.push(`${step}.${f.key}`);
        seen.add(f.key);
      }
    }
    expect(dupes).toEqual([]);
  });

  it('gives every select field a non-empty options list', () => {
    const bad = entries.flatMap(([step, fields]) =>
      fields
        .filter((f) => f.widget === 'select' && !(f.options && f.options.length > 0))
        .map((f) => `${step}.${f.key}`));
    expect(bad).toEqual([]);
  });

  it('only non-selects may omit options', () => {
    const bad = entries.flatMap(([step, fields]) =>
      fields
        .filter((f) => f.widget !== 'select' && f.options)
        .map((f) => `${step}.${f.key}`));
    expect(bad).toEqual([]);
  });

  const conds = (showIf: (typeof entries)[number][1][number]['showIf']) =>
    (showIf ? (Array.isArray(showIf) ? showIf : [showIf]) : []);

  it('every showIf references a key defined in the same step', () => {
    const bad: string[] = [];
    for (const [step, fields] of entries) {
      const keys = new Set(fields.map((f) => f.key));
      for (const f of fields) {
        for (const c of conds(f.showIf)) {
          if (!keys.has(c.key)) bad.push(`${step}.${f.key} → ${c.key}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('every showIf value is one of the controlling select’s option values', () => {
    const bad: string[] = [];
    for (const [step, fields] of entries) {
      for (const f of fields) {
        for (const c of conds(f.showIf)) {
          const controller = fields.find((g) => g.key === c.key);
          if (controller?.widget === 'checkbox') {
            // a checkbox's value is a real boolean (FE62)
            if (typeof c.value !== 'boolean') bad.push(`${step}.${f.key} → ${c.key}=${String(c.value)}`);
            continue;
          }
          const values = controller?.options?.map((o) => o.value) ?? [];
          if (!values.includes(c.value as string | number)) {
            bad.push(`${step}.${f.key} → ${c.key}=${String(c.value)}`);
          }
        }
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('DEM resolution tooltip (FIMSIM-FE51)', () => {
  const help = (step: string) =>
    STEP_FIELDS[step].find((f) => f.key === 'dem_res_m')?.help ?? '';

  it('says the coarser options are resampled from the 10 m 3DEP source', () => {
    expect(help('dem')).toMatch(/resampled/i);
    expect(help('dem')).toMatch(/10 m/);
    expect(help('dem')).toMatch(/3DEP/);
  });

  it('keeps the existing guidance: default, faster, desktop for finer', () => {
    expect(help('dem')).toMatch(/default/i);
    expect(help('dem')).toMatch(/faster/i);
    expect(help('dem')).toMatch(/desktop/i);
  });

  it('uses identical copy on the LISFLOOD and TRITON Terrain steps', () => {
    expect(help('tdem')).toBe(help('dem'));
    expect(help('dem').length).toBeGreaterThan(0);
  });
});

describe('Run step has no user time limit (FIMSIM-FE50)', () => {
  it('drops solver_timeout_s but keeps the depth time series choice', () => {
    const keys = STEP_FIELDS.run.map((f) => f.key);
    expect(keys).not.toContain('solver_timeout_s');
    expect(keys).toContain('keep_snapshots');
  });
});

// FIMSIM-FE61..FE64 — the Preparing Input Data tools on the generic form.
describe('previewKind', () => {
  it('maps each step to the preview it shows, tools included', () => {
    expect(previewKind('dem')).toBe('dem');
    expect(previewKind('tdem')).toBe('dem');
    expect(previewKind('dem_tool')).toBe('dem');
    expect(previewKind('lulc_tool')).toBe('lulc');
    expect(previewKind('flowline_tool')).toBe('boundary');
    expect(previewKind('flow_tool')).toBe('hydrograph');
    expect(previewKind('par')).toBeNull();
    expect(previewKind('run')).toBeNull();
  });
});

describe('dem_tool fields (FIMSIM-FE61)', () => {
  const byKey = Object.fromEntries(STEP_FIELDS.dem_tool.map((f) => [f.key, f]));
  it('offers 3DEP and HAND, a free cell size floored at 10 m, three formats', () => {
    expect(byKey.dem_source.options?.map((o) => o.value)).toEqual(['3dep', 'hand']);
    expect(byKey.dem_res_m.widget).toBe('number');
    expect(byKey.dem_res_m.min).toBe(10);
    expect(byKey.out_format.options?.map((o) => o.value)).toEqual(['tif', 'gpkg', 'asc']);
  });
});

describe('lulc_tool fields (FIMSIM-FE62)', () => {
  const fields = STEP_FIELDS.lulc_tool;
  const byKey = Object.fromEntries(fields.map((f) => [f.key, f]));
  it('uses fimcore\'s source names and shows the matching year list', () => {
    expect(byKey.lulc_source.options?.map((o) => o.value)).toEqual(['nlcd', 'sentinel2']);
    expect(byKey.nlcd_year.showIf).toEqual({ key: 'lulc_source', value: 'nlcd' });
    expect(byKey.sentinel2_year.showIf).toEqual({ key: 'lulc_source', value: 'sentinel2' });
    expect(byKey.sentinel2_year.options?.map((o) => o.value)).toContain(2023);
  });
  it('snaps the cell size to the source\'s native resolution when the source changes', () => {
    expect(byKey.cell_size_m.linkedDefault).toEqual(
      { key: 'lulc_source', values: { nlcd: 30, sentinel2: 10 } });
    expect(byKey.cell_size_m.min).toBe(10);
  });
  it('makes Manning optional with its own (shapefile-capable) format', () => {
    expect(byKey.do_manning.widget).toBe('checkbox');
    expect(byKey.manning_format.showIf).toEqual({ key: 'do_manning', value: true });
    expect(byKey.manning_format.options?.map((o) => o.value)).toEqual(['tif', 'gpkg', 'asc', 'shp']);
    expect(byKey.lulc_format.options?.map((o) => o.value)).toEqual(['tif', 'gpkg', 'asc']);
  });
});

describe('flowline_tool fields (FIMSIM-FE63)', () => {
  const byKey = Object.fromEntries(STEP_FIELDS.flowline_tool.map((f) => [f.key, f]));
  it('has an on/off box per output and a format next to each line output', () => {
    for (const k of ['save_main_river', 'save_all_flowlines', 'save_gages_csv', 'save_feature_ids']) {
      expect(byKey[k].widget).toBe('checkbox');
    }
    expect(byKey.main_format.showIf).toEqual({ key: 'save_main_river', value: true });
    expect(byKey.all_format.showIf).toEqual({ key: 'save_all_flowlines', value: true });
    expect(byKey.main_format.options?.map((o) => o.value)).toEqual(['shp', 'gpkg', 'tif', 'csv']);
    expect(byKey.cell_size_m.min).toBe(10);
  });
});

describe('flow_tool fields (FIMSIM-FE64)', () => {
  const byKey = Object.fromEntries(STEP_FIELDS.flow_tool.map((f) => [f.key, f]));
  it('shows the window + interval for retro/USGS and the forecast trio for forecasts', () => {
    const forecast = { key: 'source', value: 'nwm_forecast' };
    for (const k of ['start_dt', 'end_dt', 'interval_hours']) expect(byKey[k].hideIf).toEqual(forecast);
    for (const k of ['forecast_range', 'forecast_date', 'forecast_hour']) expect(byKey[k].showIf).toEqual(forecast);
    expect(byKey.ids.required).toBe(true);
    expect(byKey.forecast_date.required).toBe(true);
    expect(byKey.interval_hours.options?.map((o) => o.value)).toEqual([0.25, 0.5, 1, 3, 6, 12, 24]);
    expect(byKey.forecast_hour.options?.[0]).toEqual({ value: '', label: 'Auto (latest cycle)' });
  });
});
