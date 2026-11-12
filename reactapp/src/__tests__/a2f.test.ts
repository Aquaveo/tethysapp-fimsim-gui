// A2F (ARC-Curve2Flood) in the wizard: the model, its Run step sharing
// LISFLOOD-FP's Run behaviors, any-shape AOIs, the Flowline pick and the
// Streamflow date (docs/design-a2f.md).
import { describe, expect, it } from 'vitest';
import { preparedKindFor } from '../prepared';
import { summarizeStep } from '../StepOverview';
import { expandEventDates, previewKind, STEP_FIELDS } from '../stepFields';
import { splitResultFiles } from '../outputsMeta';
import {
  MODELS, isRunStep, modelFromSlug, needsRunConfirm, resultsKind, runSkipped, runStepOf,
} from '../steps';

const A2F = MODELS['arc-curve2flood'];
const ids = A2F.steps.map((s) => s.id);
const aoi = (steps: Record<string, string>) => ({
  steps: Object.fromEntries(Object.entries(steps).map(([k, status]) => [k, { status }])),
});

describe('A2F model', () => {
  it('has the desktop steps and runs on the portal with any area shape', () => {
    expect(ids).toEqual(['project', 'aoi', 'adem', 'aflow', 'astream', 'arun', 'results']);
    expect(modelFromSlug('arc-curve2flood')).toBe('arc-curve2flood');
    expect(resultsKind('arc-curve2flood')).toBe('simulation');
    expect(A2F.anyAoiShape).toBe(true);
    expect(MODELS['lisflood-fp'].anyAoiShape).toBeUndefined();
  });

  it('gives every job step a form (the backend keys)', () => {
    for (const id of ['adem', 'aflow', 'astream', 'arun']) expect(STEP_FIELDS[id]).toBeDefined();
    expect(previewKind('adem')).toBe('dem');
    expect(previewKind('aflow')).toBe('boundary');
  });
});

describe('A2F Run shares the Run behaviors', () => {
  it('knows both Run steps and finds the model\'s own', () => {
    expect(isRunStep('run') && isRunStep('arun')).toBe(true);
    expect(isRunStep('astream')).toBe(false);
    expect(runStepOf(A2F.steps)).toBe('arun');
    expect(runStepOf(MODELS.triton.steps)).toBeNull();
  });

  it('asks before leaving Run forward with no run, and stops asking after one', () => {
    expect(needsRunConfirm(A2F.steps, 'arun', 'results', [aoi({ astream: 'succeeded' })]))
      .toBe(true);
    expect(needsRunConfirm(A2F.steps, 'arun', 'results', [aoi({ arun: 'succeeded' })]))
      .toBe(false);
  });

  it('marks Run skipped once the user is past it without a run', () => {
    expect(runSkipped(A2F.steps, 'results', [aoi({ astream: 'succeeded' })])).toBe(true);
    expect(runSkipped(A2F.steps, 'results', [aoi({ arun: 'succeeded' })])).toBe(false);
    expect(runSkipped(A2F.steps, 'astream', [aoi({})])).toBe(false);
  });

  it('files the flood maps under Results, the rest under Input Data', () => {
    const { inputs, results } = splitResultFiles(
      [{ step: 'arun' }, { step: 'aflow' }, { step: 'run' }]);
    expect(results.map((f) => f.step)).toEqual(['arun', 'run']);
    expect(inputs.map((f) => f.step)).toEqual(['aflow']);
  });
});

describe('A2F prepared inputs', () => {
  const get = (cfg: Record<string, unknown>) => (k: string) => cfg[k];
  it('DEM picks a DEM, Flowline picks the Flowline tool network', () => {
    expect(preparedKindFor('adem', get({ dem_input: 'prepared' }))).toBe('dem');
    expect(preparedKindFor('aflow', get({ source: 'prepared' }))).toBe('flowline');
    expect(preparedKindFor('aflow', get({ source: 'nhd' }))).toBeNull();
  });
});

describe('A2F Streamflow date', () => {
  it('stays a bare day — the hour is its own field', () => {
    const out = expandEventDates({ date: '2019-09-19', hour_utc: 17 }, STEP_FIELDS.astream);
    expect(out.date).toBe('2019-09-19');
  });

  it('other date fields still expand', () => {
    const out = expandEventDates({ start_dt: '2016-10-05' },
      [{ key: 'start_dt', widget: 'date' }]);
    expect(out.start_dt).toBe('2016-10-05T00:00');
  });
});

describe('A2F step summaries', () => {
  it.each([
    ['adem', { dem_input: 'download', dem_res_m: 10 }, '3DEP @ 10 m'],
    ['aflow', { source: 'prepared' }, 'network from the Flowline tool'],
    ['astream', { source: 'nwm', date: '2019-09-19', hour_utc: 17 }, 'NWM · 2019-09-19 17:00 UTC'],
    ['astream', { source: 'geoglows', date: '2019-09-19', hour_utc: 0 }, 'GEOGLOWS · 2019-09-19 00:00 UTC'],
    ['arun', { preset: 'classic' }, 'classic settings'],
  ])('%s %o → %s', (step, cfg, line) => {
    expect(summarizeStep(step, cfg)).toBe(line);
  });
});
