// reactapp/src/__tests__/steps.test.ts — FIMSIM-FE56: leaving the Run step
// forward with no successful run asks for confirmation.
import { describe, expect, it } from 'vitest';
import { MODELS, needsRunConfirm, stepDone } from '../steps';
import type { ServerAoi } from '../api';

const STEPS = MODELS['lisflood-fp'].steps;
const TRITON = MODELS.triton.steps;

const aoi = (status?: string, step = 'run'): ServerAoi => ({
  steps: status ? { [step]: { id: 1, status, finished: null } } : {},
} as unknown as ServerAoi);

describe('needsRunConfirm', () => {
  it('asks when moving forward from Run with no run at all', () => {
    expect(needsRunConfirm(STEPS, 'run', 'results', [aoi()])).toBe(true);
  });

  it('asks when the run is still queued or failed', () => {
    expect(needsRunConfirm(STEPS, 'run', 'results', [aoi('queued')])).toBe(true);
    expect(needsRunConfirm(STEPS, 'run', 'results', [aoi('failed')])).toBe(true);
  });

  it('does not ask once any AOI has a succeeded run', () => {
    expect(needsRunConfirm(STEPS, 'run', 'results', [aoi('failed'), aoi('succeeded')])).toBe(false);
  });

  it('does not ask when going back from Run, or when leaving another step', () => {
    expect(needsRunConfirm(STEPS, 'run', 'par', [aoi()])).toBe(false);
    expect(needsRunConfirm(STEPS, 'par', 'run', [aoi()])).toBe(false);
    expect(needsRunConfirm(STEPS, 'bdy', 'results', [aoi()])).toBe(false);
  });

  it('never asks on a model without a Run step (TRITON)', () => {
    expect(needsRunConfirm(TRITON, 'tcfg', 'results', [aoi()])).toBe(false);
  });

  it('asks with no AOIs at all (nothing could have run)', () => {
    expect(needsRunConfirm(STEPS, 'run', 'results', [])).toBe(true);
  });
});

// FIMSIM-FE55 — a rail step is ✓ only when it really succeeded, never by
// position, so a skipped Run step keeps its number.
describe('stepDone', () => {
  it('marks Project done once a project exists, AOI once an area exists', () => {
    expect(stepDone('project', [], false)).toBe(false);
    expect(stepDone('project', [], true)).toBe(true);
    expect(stepDone('aoi', [], true)).toBe(false);
    expect(stepDone('aoi', [aoi()], true)).toBe(true);
  });

  it('marks a job step done only when it succeeded for every AOI', () => {
    expect(stepDone('dem', [aoi('succeeded', 'dem'), aoi('succeeded', 'dem')], true)).toBe(true);
    expect(stepDone('dem', [aoi('succeeded', 'dem'), aoi('failed', 'dem')], true)).toBe(false);
    expect(stepDone('dem', [aoi('succeeded', 'dem'), aoi()], true)).toBe(false);
    expect(stepDone('run', [aoi()], true)).toBe(false);
    expect(stepDone('run', [], true)).toBe(false);
  });

  it('never marks Results done (there is nothing past it)', () => {
    expect(stepDone('results', [aoi('succeeded')], true)).toBe(false);
  });
});
