// reactapp/src/__tests__/aoiRules.test.ts — #xi (FIMSIM-FE35): one study area
// per project. The multi-feature picker becomes a single choice, and adding an
// area when one exists asks to replace it.
import { describe, expect, it } from 'vitest';
import { defaultPick, needsReplaceConfirm, replaceWarning } from '../aoiRules';

describe('needsReplaceConfirm', () => {
  it('asks only when an area already exists', () => {
    expect(needsReplaceConfirm(0)).toBe(false);
    expect(needsReplaceConfirm(1)).toBe(true);
    expect(needsReplaceConfirm(3)).toBe(true);
  });
});

describe('replaceWarning', () => {
  it('names the current area and says its step results go too', () => {
    const msg = replaceWarning([{ name: 'Neuse River, NC (example)' }]);
    expect(msg).toMatch(/Neuse River/);
    expect(msg).toMatch(/results/i);
  });

  it('counts a legacy multi-area project', () => {
    expect(replaceWarning([{ name: 'A' }, { name: 'B' }])).toMatch(/2 study areas/);
  });
});

describe('defaultPick', () => {
  it('pre-selects the first feature of a multi-feature upload', () => {
    expect(defaultPick([{ index: 4 }, { index: 7 }])).toBe(4);
    expect(defaultPick([])).toBeNull();
  });
});
