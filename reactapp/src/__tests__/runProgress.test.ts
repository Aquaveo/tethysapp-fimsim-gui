// Progress helpers behind the run-status UX (feedback #1, #2).
import { describe, expect, it } from 'vitest';
import { formatElapsed, phaseLabel } from '../runProgress';

describe('formatElapsed', () => {
  it('formats sub-hour durations as m:ss', () => {
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(5_000)).toBe('0:05');
    expect(formatElapsed(83_000)).toBe('1:23');
    expect(formatElapsed(600_000)).toBe('10:00');
  });

  it('formats hour-plus durations as h:mm:ss', () => {
    expect(formatElapsed(3_661_000)).toBe('1:01:01');
  });

  it('never returns a negative or NaN clock', () => {
    expect(formatElapsed(-5)).toBe('0:00');
    expect(formatElapsed(NaN)).toBe('0:00');
  });
});

describe('phaseLabel', () => {
  it('maps worker statuses to human phases', () => {
    expect(phaseLabel('queued')).toBe('Queued');
    expect(phaseLabel('running')).toBe('Running');
    // the "upload hit 100% then nothing" gap — now clearly a phase
    expect(phaseLabel('uploading')).toBe('Saving results');
    expect(phaseLabel('pending')).toBe('Starting');
  });

  it('falls back to the raw status for anything unknown', () => {
    expect(phaseLabel('weird')).toBe('weird');
  });
});
