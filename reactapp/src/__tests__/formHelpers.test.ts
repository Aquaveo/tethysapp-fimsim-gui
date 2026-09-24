// Pure helpers behind three Copilot-review fixes: decimal number entry,
// model-switch safety, and per-model Results filtering.
import { describe, expect, it } from 'vitest';
import { coerceConfigNumbers, fieldVisible, STEP_FIELDS } from '../stepFields';
import { resolveActiveStep } from '../steps';
import { keepModelSteps } from '../outputsMeta';
import { MODELS } from '../steps';

describe('coerceConfigNumbers', () => {
  const fields = [
    { key: 'value', label: 'v', widget: 'number' as const },
    { key: 'name', label: 'n', widget: 'text' as const },
  ];

  it('converts a completed decimal string to a number at submit time', () => {
    expect(coerceConfigNumbers({ value: '0.0001' }, fields)).toEqual({ value: 0.0001 });
  });

  it('leaves non-number fields untouched', () => {
    expect(coerceConfigNumbers({ name: '0.5' }, fields)).toEqual({ name: '0.5' });
  });

  it('maps an empty number string to null (dropped downstream)', () => {
    expect(coerceConfigNumbers({ value: '' }, fields)).toEqual({ value: null });
  });

  it('already-numeric values pass through', () => {
    expect(coerceConfigNumbers({ value: 3 }, fields)).toEqual({ value: 3 });
  });
});

describe('fieldVisible (source-aware year dropdowns)', () => {
  const get = (cfg: Record<string, unknown>) => (k: string) => cfg[k];

  it('requires every condition in an array to hold', () => {
    const showIf = [{ key: 'fric_mode', value: 'varying' },
                    { key: 'lulc_download_source', value: 'esri' }];
    expect(fieldVisible(showIf, get({ fric_mode: 'varying', lulc_download_source: 'esri' }))).toBe(true);
    expect(fieldVisible(showIf, get({ fric_mode: 'varying', lulc_download_source: 'nlcd' }))).toBe(false);
    expect(fieldVisible(showIf, get({ fric_mode: 'fixed', lulc_download_source: 'esri' }))).toBe(false);
  });

  it('the two Manning year fields are mutually exclusive by source', () => {
    const esri = get({ fric_mode: 'varying', lulc_download_source: 'esri' });
    const fields = STEP_FIELDS.manning;
    const lulc = fields.find((f) => f.key === 'lulc_year')!;
    const nlcd = fields.find((f) => f.key === 'nlcd_year')!;
    expect(fieldVisible(lulc.showIf, esri)).toBe(true);
    expect(fieldVisible(nlcd.showIf, esri)).toBe(false);
    // Esri years exclude anything before 2017; NLCD offers 2021 but not 2020
    expect(lulc.options?.map((o) => o.value)).toContain(2023);
    expect(lulc.options?.map((o) => o.value)).not.toContain(2016);
    expect(nlcd.options?.map((o) => o.value)).toEqual(
      ['2021', '2019', '2016', '2013', '2011', '2008', '2006', '2004', '2001']);
  });
});

describe('resolveActiveStep', () => {
  const triton = MODELS.triton.steps;

  it('keeps the step when the model has it', () => {
    expect(resolveActiveStep(triton, 'tdem', true)).toBe('tdem');
  });

  it('falls back to aoi when the step is absent but a project exists', () => {
    // switching from LISFLOOD "run" to TRITON: "run" is not a TRITON step
    expect(resolveActiveStep(triton, 'run', true)).toBe('aoi');
  });

  it('falls back to project when there is no project yet', () => {
    expect(resolveActiveStep(triton, 'run', false)).toBe('project');
  });
});

describe('keepModelSteps', () => {
  it('drops steps that are not part of the active model', () => {
    const entries: [string, { id: number }][] = [
      ['dem', { id: 1 }], ['run', { id: 2 }], ['tdem', { id: 3 }],
    ];
    expect(keepModelSteps(entries, ['tdem', 'tfric', 'tbc', 'thyg', 'tcfg']))
      .toEqual([['tdem', { id: 3 }]]);
  });
});
