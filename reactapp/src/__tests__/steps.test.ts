// reactapp/src/__tests__/steps.test.ts — FIMSIM-FE56: leaving the Run step
// forward with no successful run asks for confirmation.
import { describe, expect, it } from 'vitest';
import {
  CATEGORIES, MODELS, headerModel, isToolModel, modelBadgeClass, modelFromSlug,
  modelsInCategory, needsRunConfirm, resultsKind, runSkipped, stepDone, wizardPath,
} from '../steps';
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

// FIMSIM-FE58 — the header badge shows the project's model only once a
// project is open (/new/<id>…), never on /new itself.
describe('headerModel', () => {
  it('is null without a project (the /new Project step)', () => {
    expect(headerModel(null, 'lisflood-fp')).toBeNull();
  });

  it('is the active model once a project is open', () => {
    expect(headerModel(29, 'triton')).toBe('triton');
    expect(headerModel(3, 'lisflood-fp')).toBe('lisflood-fp');
  });
});

// FIMSIM-FE60 — the desktop landing page's two categories, as project modes.
describe('MODELS categories', () => {
  it('splits the six modes into the two desktop categories, input data first', () => {
    expect(CATEGORIES.map((c) => c.id)).toEqual(['input-data', 'flood-mapping']);
    expect(modelsInCategory('flood-mapping')).toEqual(['lisflood-fp', 'triton']);
    expect(modelsInCategory('input-data'))
      .toEqual(['dem-tool', 'lulc-tool', 'flowline-tool', 'flow-tool']);
    expect(CATEGORIES[0].description)
      .toBe('Download and process the geospatial data needed to configure a flood model.');
  });

  it('calls the blue category Flood Modeling (FIMSIM-FE66, Sagy 2026-10-22)', () => {
    const blue = CATEGORIES.find((c) => c.id === 'flood-mapping');
    expect(blue?.title).toBe('Flood Modeling');
    expect(blue?.description)
      .toBe('Build a complete input package for a supported 2D flood simulation model.');
  });

  it('round-trips every tool slug through wizardPath / modelFromSlug', () => {
    for (const m of modelsInCategory('input-data')) {
      expect(modelFromSlug(m)).toBe(m);
      expect(wizardPath({ id: 7, model: m })).toBe(`/new/7/${m}`);
    }
    expect(modelFromSlug('dem_tool')).toBe('lisflood-fp');   // a STEP key is not a slug
  });

  it('gives every tool a four-step wizard whose job step is the backend step key', () => {
    const expected: Record<string, string> = {
      'dem-tool': 'dem_tool', 'lulc-tool': 'lulc_tool',
      'flowline-tool': 'flowline_tool', 'flow-tool': 'flow_tool',
    };
    for (const m of modelsInCategory('input-data')) {
      const ids = MODELS[m].steps.map((s) => s.id);
      expect(ids).toEqual(['project', 'aoi', expected[m], 'results']);
      expect(MODELS[m].steps[3].label).toBe('Downloads');
      expect(MODELS[m].runsOnPortal).toBe(true);
      expect(isToolModel(m)).toBe(true);
    }
    expect(isToolModel('triton')).toBe(false);
  });

  it('colours badges by category: cyan runs-here, purple deck, green tool', () => {
    expect(modelBadgeClass('lisflood-fp')).toBe('');
    expect(modelBadgeClass('triton')).toBe(' is-deck');
    expect(modelBadgeClass('flow-tool')).toBe(' is-tool');
  });

  it('tells the Results step what it is: a simulation, a deck, or tool downloads', () => {
    expect(resultsKind('lisflood-fp')).toBe('simulation');
    expect(resultsKind('triton')).toBe('deck');
    for (const m of modelsInCategory('input-data')) expect(resultsKind(m)).toBe('tools');
  });
});

// FIMSIM-FE70 — Nathan, 2026-10-22: once the user has gone past Run without a
// successful run, the Run node shows a warning instead of a bare number.
describe('runSkipped', () => {
  it('is true past the Run step with no succeeded run on any area', () => {
    expect(runSkipped(STEPS, 'results', [aoi()])).toBe(true);
    expect(runSkipped(STEPS, 'results', [aoi('failed')])).toBe(true);
    expect(runSkipped(STEPS, 'results', [])).toBe(true);
  });

  it('is false on or before the Run step, and once any area ran', () => {
    expect(runSkipped(STEPS, 'run', [aoi()])).toBe(false);
    expect(runSkipped(STEPS, 'par', [aoi()])).toBe(false);
    expect(runSkipped(STEPS, 'results', [aoi('failed'), aoi('succeeded')])).toBe(false);
  });

  it('is never true on a model without a Run step (TRITON, the tools)', () => {
    expect(runSkipped(TRITON, 'results', [aoi()])).toBe(false);
    expect(runSkipped(MODELS['dem-tool'].steps, 'results', [aoi()])).toBe(false);
  });
});
