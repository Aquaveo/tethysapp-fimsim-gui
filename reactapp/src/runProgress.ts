// reactapp/src/runProgress.ts
// Small pure helpers for the run-status UI: a live elapsed clock and
// human-readable phase names, so an active job never looks frozen (feedback
// #1 elapsed time, #2 the phase after a stage hits 100%).

/** Milliseconds → "m:ss", or "h:mm:ss" past an hour. Guards NaN/negatives. */
export function formatElapsed(ms: number): string {
  const total = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

const PHASES: Record<string, string> = {
  pending: 'Starting',
  queued: 'Queued',
  uploading: 'Saving results',
  running: 'Running',
  succeeded: 'Done',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

/** Worker status → the phase name shown to the user. */
export function phaseLabel(status: string): string {
  return PHASES[status] ?? status;
}
