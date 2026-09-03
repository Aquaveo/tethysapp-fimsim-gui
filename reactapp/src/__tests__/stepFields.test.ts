// reactapp/src/__tests__/stepFields.test.ts — consistency checks over the
// wizard's field specs so a typo in a key/showIf can't silently hide a field.
import { describe, expect, it } from 'vitest';
import { STEP_FIELDS } from '../stepFields';
import { STEPS } from '../steps';

const entries = Object.entries(STEP_FIELDS);

describe('STEP_FIELDS consistency', () => {
  it('covers only real wizard steps', () => {
    const known = new Set(STEPS.map((s) => s.id));
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

  it('every showIf references a key defined in the same step', () => {
    const bad: string[] = [];
    for (const [step, fields] of entries) {
      const keys = new Set(fields.map((f) => f.key));
      for (const f of fields) {
        if (f.showIf && !keys.has(f.showIf.key)) bad.push(`${step}.${f.key} → ${f.showIf.key}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('every showIf value is one of the controlling select’s option values', () => {
    const bad: string[] = [];
    for (const [step, fields] of entries) {
      for (const f of fields) {
        if (!f.showIf) continue;
        const controller = fields.find((g) => g.key === f.showIf!.key);
        const values = controller?.options?.map((o) => o.value) ?? [];
        if (!values.includes(f.showIf.value as string | number)) {
          bad.push(`${step}.${f.key} → ${f.showIf.key}=${String(f.showIf.value)}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});
