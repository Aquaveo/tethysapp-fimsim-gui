// reactapp/src/hydrographAxis.ts
// FIMSIM-FE53: date tick labels for the hydrograph. Everything is UTC — the
// NWM/gage CSV timestamps are UTC and the event start_dt parses as UTC — so
// a tick, the tooltip and the caption never disagree by a timezone.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const two = (n: number) => String(n).padStart(2, '0');

/** "Oct 05"; with the clock on sub-two-day windows ("Oct 05 14:00"); with the
 *  year on windows over half a year ("Oct 05 2016"). */
export function formatDateTick(ms: number, spanMs: number): string {
  const d = new Date(ms);
  const base = `${MONTHS[d.getUTCMonth()]} ${two(d.getUTCDate())}`;
  if (spanMs < 2 * DAY) return `${base} ${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`;
  if (spanMs > 182 * DAY) return `${base} ${d.getUTCFullYear()}`;
  return base;
}

/** Ticks at least a day apart once the window spans days (never two labels
 *  for one date); hourly on short windows. echarts thins further as needed. */
export function dateAxisMinInterval(spanMs: number): number {
  return spanMs < 2 * DAY ? HOUR : DAY;
}

/** Full date-time for tooltips and captions: "Oct 05, 2016 14:00 UTC". */
export function formatDateTime(ms: number): string {
  const d = new Date(ms);
  return `${MONTHS[d.getUTCMonth()]} ${two(d.getUTCDate())}, ${d.getUTCFullYear()} `
    + `${two(d.getUTCHours())}:${two(d.getUTCMinutes())} UTC`;
}
