// reactapp/src/__tests__/hydrographAxis.test.ts — FIMSIM-FE53: the hydrograph's
// X-axis ticks are calendar dates (short form), thinned but never gone, and the
// tooltip/caption keep the full date-time. All UTC: NWM/gage timestamps are UTC.
import { describe, expect, it } from 'vitest';
import { dateAxisMinInterval, formatDateTick, formatDateTime } from '../hydrographAxis';

const DAY = 86_400_000;
const oct5 = Date.UTC(2016, 9, 5, 14, 0);

describe('formatDateTick', () => {
  it('is a short "Mon DD" date on a multi-day window', () => {
    expect(formatDateTick(Date.UTC(2016, 9, 5), 5 * DAY)).toBe('Oct 05');
    expect(formatDateTick(Date.UTC(2016, 9, 6), 5 * DAY)).toBe('Oct 06');
  });

  it('keeps the clock time when the window is shorter than two days', () => {
    expect(formatDateTick(oct5, 12 * 3_600_000)).toBe('Oct 05 14:00');
  });

  it('adds the year on windows longer than half a year', () => {
    expect(formatDateTick(Date.UTC(2016, 9, 5), 200 * DAY)).toBe('Oct 05 2016');
  });
});

describe('dateAxisMinInterval', () => {
  it('spaces ticks at least a day apart on multi-day windows, an hour on short ones', () => {
    expect(dateAxisMinInterval(5 * DAY)).toBe(DAY);
    expect(dateAxisMinInterval(30 * DAY)).toBe(DAY);
    expect(dateAxisMinInterval(12 * 3_600_000)).toBe(3_600_000);
  });
});

describe('formatDateTime', () => {
  it('is the full UTC date-time for tooltips and captions', () => {
    expect(formatDateTime(oct5)).toBe('Oct 05, 2016 14:00 UTC');
  });
});
