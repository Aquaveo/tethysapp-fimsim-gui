// reactapp/src/__tests__/manningRules.test.ts — FIMSIM-BE15 / FE52: Manning's n
// has ONE enforced limit (the hard band) and a per-class literature range
// that only WARNS. Edits are no longer clamped to the class range.
import { describe, expect, it } from 'vitest';
import { HARD_N, clampHard, rowWarning, warningCount } from '../manningRules';

const trees = { label: 'Trees', min: 0.08, max: 0.14, default: 0.11 };
const clouds = { label: 'Clouds', min: null, max: null, default: null };

describe('clampHard', () => {
  it('keeps values inside the hard band and pins values outside it', () => {
    expect(clampHard(0.05)).toBe(0.05);
    expect(clampHard(HARD_N.min - 0.001)).toBe(HARD_N.min);
    expect(clampHard(HARD_N.max + 1)).toBe(HARD_N.max);
  });
});

describe('rowWarning', () => {
  it('is silent inside the class range', () => {
    expect(rowWarning(0.1, trees)).toBeNull();
    expect(rowWarning(0.08, trees)).toBeNull();
    expect(rowWarning(0.14, trees)).toBeNull();
  });

  it('warns, naming the recommended range, outside it — but never blocks', () => {
    expect(rowWarning(0.05, trees)).toMatch(/0\.080.*0\.140/);
    expect(rowWarning(0.2, trees)).toMatch(/recommended/);
  });

  it('is silent for classes with no literature range (Clouds)', () => {
    expect(rowWarning(0.5, clouds)).toBeNull();
  });
});

describe('warningCount', () => {
  it('counts edited classes outside their range; defaults never count', () => {
    const rows = { 2: trees, 10: clouds };
    expect(warningCount({ default: 0.045 }, rows)).toBe(0);
    expect(warningCount({ default: 0.045, 2: 0.05 }, rows)).toBe(1);
    expect(warningCount({ default: 0.045, 2: 0.1, 10: 0.9 }, rows)).toBe(0);
  });
});
