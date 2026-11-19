// reactapp/src/__tests__/stepOverview.test.ts — FIMSIM-FE75: the Run summary
// showed "time limit 3600 s" while the portal's limit is 6 h (server-only).
import { describe, expect, it } from 'vitest';
import { summarizeStep } from '../StepOverview';

describe('Run step summary time limit', () => {
  it('names the portal default when the config does not carry one', () => {
    expect(summarizeStep('run', {})).toBe('time limit 6 h (portal default)');
  });
  it('shows a configured limit in hours', () => {
    expect(summarizeStep('run', { solver_timeout_s: 7200 })).toBe('time limit 2 h');
  });
});
