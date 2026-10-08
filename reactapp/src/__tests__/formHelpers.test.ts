// Pure helpers behind three Copilot-review fixes: decimal number entry,
// model-switch safety, and per-model Results filtering.
import { describe, expect, it } from 'vitest';
import { coerceConfigNumbers, expandEventDates, fieldVisible, STEP_FIELDS } from '../stepFields';
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

describe('expandEventDates (date-only picker → full-day bounds)', () => {
  const fields = [
    { key: 'start_dt', label: 's', widget: 'date' as const },
    { key: 'end_dt', label: 'e', widget: 'date' as const, endOfDay: true },
    { key: 'gage_id', label: 'g', widget: 'text' as const },
  ];

  it('expands a bare date to 00:00 (start) and 23:59 (end)', () => {
    expect(expandEventDates(
      { start_dt: '2016-10-05', end_dt: '2016-10-15', gage_id: '02089000' }, fields))
      .toEqual({ start_dt: '2016-10-05T00:00', end_dt: '2016-10-15T23:59', gage_id: '02089000' });
  });

  it('leaves an already-timed value and non-date fields untouched', () => {
    const out = expandEventDates({ start_dt: '2016-10-05T06:30', gage_id: '5' }, fields);
    expect(out.start_dt).toBe('2016-10-05T06:30');
    expect(out.gage_id).toBe('5');
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

describe('textPreviewDefaultOpen (bug-round #ix: BC files shown by default)', async () => {
  const { textPreviewDefaultOpen } = await import('../TextPreview');

  it('opens the Boundaries text files by default, even on multi-AOI projects', () => {
    expect(textPreviewDefaultOpen('bci', 1)).toBe(true);
    expect(textPreviewDefaultOpen('tbc', 1)).toBe(true);
    expect(textPreviewDefaultOpen('bci', 3)).toBe(true);
    expect(textPreviewDefaultOpen('tbc', 3)).toBe(true);
  });

  it('keeps the Settings files open only on single-AOI projects (unchanged)', () => {
    expect(textPreviewDefaultOpen('par', 1)).toBe(true);
    expect(textPreviewDefaultOpen('tcfg', 1)).toBe(true);
    expect(textPreviewDefaultOpen('par', 2)).toBe(false);
  });

  it('leaves steps without text previews collapsed', () => {
    expect(textPreviewDefaultOpen('dem', 1)).toBe(false);
  });
});

describe('TRITON boundary value field (bug-round #v/#vi)', async () => {
  const { STEP_FIELDS, applyLinkedDefaults } = await import('../stepFields');
  const tbc = STEP_FIELDS.tbc;
  const value = tbc.find((f) => f.key === 'value')!;

  it('cannot go negative or below 0.001, steps at the 0.001 level, has a ceiling', () => {
    expect(value.min).toBe(0.001);
    expect(value.step).toBe(0.001);
    expect(typeof value.max).toBe('number');
    expect(value.max!).toBeGreaterThan(0.001);
  });

  it('swaps in the per-type default when the boundary type changes', () => {
    // slope → Froude: 0.001 is a nonsense Froude number, so the default follows
    const froude = applyLinkedDefaults({ bc_type: 2, value: 0.001 }, tbc, 'bc_type', 3);
    expect(froude.value).toBe(0.5);
    const slope = applyLinkedDefaults({ bc_type: 3, value: 0.5 }, tbc, 'bc_type', 2);
    expect(slope.value).toBe(0.001);
  });

  it('leaves unrelated fields alone when some other field changes', () => {
    const out = applyLinkedDefaults({ bc_type: 2, value: 0.004 }, tbc, 'something', 'x');
    expect(out).toEqual({ bc_type: 2, value: 0.004 });
  });
});

describe('rangeProblems', async () => {
  const { rangeProblems } = await import('../stepFields');
  const fields = [
    { key: 'v', label: 'Boundary value', widget: 'number' as const, min: 0.001, max: 2 },
    { key: 'free', label: 'Free', widget: 'number' as const },
  ];

  it('reports a number below its minimum, naming the field and the bounds', () => {
    const problems = rangeProblems({ v: -0.5 }, fields);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/Boundary value/);
    expect(problems[0]).toMatch(/0\.001/);
  });

  it('reports a number above its maximum', () => {
    expect(rangeProblems({ v: 5 }, fields)).toHaveLength(1);
  });

  it('accepts in-range values, blanks, and fields without bounds', () => {
    expect(rangeProblems({ v: 0.001, free: -99 }, fields)).toEqual([]);
    expect(rangeProblems({ v: null }, fields)).toEqual([]);
    expect(rangeProblems({}, fields)).toEqual([]);
  });
});

describe('manningTableSource (bug-round #iv: Manning table on TRITON too)', async () => {
  const { manningTableSource } = await import('../stepFields');
  const get = (cfg: Record<string, unknown>) => (k: string) => cfg[k];

  it('maps the LISFLOOD Roughness source names straight through', () => {
    expect(manningTableSource('manning', get({ fric_mode: 'varying', lulc_download_source: 'esri' }))).toBe('esri');
    expect(manningTableSource('manning', get({ fric_mode: 'varying', lulc_download_source: 'nlcd' }))).toBe('nlcd');
  });

  it('translates the TRITON source keys (download / download_nlcd) to the table keys', () => {
    expect(manningTableSource('tfric', get({ fric_mode: 'varying', lulc_source: 'download' }))).toBe('esri');
    expect(manningTableSource('tfric', get({ fric_mode: 'varying', lulc_source: 'download_nlcd' }))).toBe('nlcd');
  });

  it('shows no table for fixed friction or for steps that have no land cover', () => {
    expect(manningTableSource('tfric', get({ fric_mode: 'fixed', lulc_source: 'download' }))).toBeNull();
    expect(manningTableSource('manning', get({ fric_mode: 'fixed' }))).toBeNull();
    expect(manningTableSource('dem', get({ fric_mode: 'varying' }))).toBeNull();
  });

  it('defaults to Esri when the source is still unset (server default)', () => {
    expect(manningTableSource('tfric', get({ fric_mode: 'varying' }))).toBe('esri');
  });
});

describe('LISFLOOD bed slope at outflow is clamped to real channel slopes', async () => {
  const { STEP_FIELDS, rangeProblems } = await import('../stepFields');
  const bci = STEP_FIELDS.bci;
  const slope = bci.find((f) => f.key === 'downstream_slope')!;

  it('cannot go negative: floor is 1e-5 (flatter than the lower Mississippi)', () => {
    expect(slope.min).toBe(0.00001);
  });

  it('tops out at 0.1 (a 10 % cascade reach), not 145', () => {
    expect(slope.max).toBe(0.1);
  });

  it('steps finely enough that the 0.0001 default sits on the grid', () => {
    expect(slope.step).toBe(0.00001);
    expect((0.0001 - slope.min!) / slope.step!).toBeCloseTo(Math.round((0.0001 - slope.min!) / slope.step!), 6);
  });

  it('rejects the values the spinner used to reach, keeps the default', () => {
    expect(rangeProblems({ downstream_slope: -0.0001 }, bci)).toHaveLength(1);
    expect(rangeProblems({ downstream_slope: 145.0001 }, bci)).toHaveLength(1);
    expect(rangeProblems({ downstream_slope: 0.0001 }, bci)).toEqual([]);
  });
});

describe('wizardPath / modelFromSlug (FIMSIM-FE48: the model lives on the project)', async () => {
  const { wizardPath, modelFromSlug, DEFAULT_MODEL } = await import('../steps');

  it('builds an unslugged link for the default model', () => {
    expect(wizardPath({ id: 29, model: 'lisflood-fp' })).toBe('/new/29');
  });

  it('carries the TRITON slug so reopening a TRITON project never flips to LISFLOOD', () => {
    expect(wizardPath({ id: 29, model: 'triton' })).toBe('/new/29/triton');
  });

  it('falls back to the default model when a project has no model yet', () => {
    expect(wizardPath({ id: 7 })).toBe('/new/7');
  });

  it('reads a URL slug back to a model, defaulting unknown or missing slugs', () => {
    expect(modelFromSlug('triton')).toBe('triton');
    expect(modelFromSlug(undefined)).toBe(DEFAULT_MODEL);
    expect(modelFromSlug('hec-ras')).toBe(DEFAULT_MODEL);
  });
});
