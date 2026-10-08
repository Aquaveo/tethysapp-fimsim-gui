// reactapp/src/__tests__/stepFields.test.ts — consistency checks over the
// wizard's field specs so a typo in a key/showIf can't silently hide a field.
import { describe, expect, it } from 'vitest';
import { STEP_FIELDS } from '../stepFields';
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
