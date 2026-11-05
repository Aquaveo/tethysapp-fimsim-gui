// reactapp/src/__tests__/preparedSteps.test.ts — FE72 (BE22): Roughness
// offers a file from a Preparing Input Data tool, like Terrain.
import { describe, expect, it } from 'vitest';
import { summarizeStep } from '../StepOverview';
import { PICK_NOUN, preparedKindFor } from '../prepared';
import { STEP_FIELDS, applyLinkedDefaults, fieldVisible, manningTableSource } from '../stepFields';

const getter = (cfg: Record<string, unknown>) => (k: string) => cfg[k];
const field = (step: string, key: string) => STEP_FIELDS[step].find((f) => f.key === key)!;
const shown = (step: string, key: string, cfg: Record<string, unknown>) => {
  const f = field(step, key);
  return fieldVisible(f.showIf, getter(cfg), f.hideIf);
};

describe('preparedKindFor', () => {
  it.each([
    ['dem', { dem_input: 'prepared' }, 'dem'],
    ['tdem', { dem_input: 'download' }, null],
    ['manning', { manning_input: 'prepared_manning' }, 'manning'],
    ['tfric', { manning_input: 'prepared_lulc' }, 'lulc'],
    ['manning', { manning_input: 'download' }, null],
    ['par', { bdy_source: 'prepared' }, null],
  ])('%s %o → %s', (step, cfg, kind) => {
    expect(preparedKindFor(step, getter(cfg))).toBe(kind);
  });
  it('names every kind for the missing-pick message', () => {
    expect(PICK_NOUN.manning).toBe("Manning's n grid");
  });
});

describe.each([
  ['manning', 'lulc_download_source'],
  ['tfric', 'lulc_source'],
])('Roughness input on %s', (step, sourceKey) => {
  it('offers the two LULC & Manning tool files', () => {
    const values = field(step, 'manning_input').options!.map((o) => o.value);
    expect(values).toEqual(['download', 'prepared_manning', 'prepared_lulc']);
  });
  it('a Manning grid hides friction, source, years and the class table', () => {
    const cfg = { manning_input: 'prepared_manning', fric_mode: 'varying', [sourceKey]: 'nlcd' };
    for (const k of ['fric_mode', sourceKey, 'nlcd_year', 'lulc_year']) {
      expect(shown(step, k, cfg)).toBe(false);
    }
    expect(manningTableSource(step, getter(cfg))).toBeNull();
  });
  it('a land cover keeps the source (for its classes) and the table, not the years', () => {
    const nlcd = sourceKey === 'lulc_source' ? 'download_nlcd' : 'nlcd';
    const cfg = { manning_input: 'prepared_lulc', fric_mode: 'varying', [sourceKey]: nlcd };
    expect(shown(step, sourceKey, cfg)).toBe(true);
    expect(shown(step, 'nlcd_year', cfg)).toBe(false);
    expect(shown(step, 'fric_mode', cfg)).toBe(false);
    expect(manningTableSource(step, getter(cfg))).toBe('nlcd');
  });
  it('picking a file switches a fixed friction back to varying', () => {
    const out = applyLinkedDefaults({ fric_mode: 'fixed', manning_input: 'prepared_lulc' },
      STEP_FIELDS[step], 'manning_input', 'prepared_lulc');
    expect(out.fric_mode).toBe('varying');
  });
});

describe('step summaries name a picked file', () => {
  it('Roughness', () => {
    expect(summarizeStep('manning', { manning_input: 'prepared_manning' }))
      .toBe("Manning's n grid from the LULC & Manning tool");
    expect(summarizeStep('tfric', { manning_input: 'prepared_lulc', lulc_source: 'download_nlcd' }))
      .toBe('NLCD land cover from the LULC & Manning tool');
  });
});
