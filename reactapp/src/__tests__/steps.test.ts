// reactapp/src/__tests__/steps.test.ts — FIMSIM-FE56: leaving the Run step
// forward with no successful run asks for confirmation.
import { describe, expect, it } from 'vitest';
import { MODELS, needsRunConfirm } from '../steps';
import type { ServerAoi } from '../api';

const STEPS = MODELS['lisflood-fp'].steps;
const TRITON = MODELS.triton.steps;

const aoi = (status?: string): ServerAoi => ({
  steps: status ? { run: { id: 1, status, finished: null } } : {},
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
