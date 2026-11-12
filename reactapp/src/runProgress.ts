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

/** FIMSIM-FE75: failed status polls in a row before the page says so. */
export const POLL_FAILS_BEFORE_BANNER = 3;

/**
 * The banner text once the status polls keep failing, else null. An
 * occasional failure is ignored; 401/403 means the portal session expired.
 */
export function pollProblem(failures: number, lastStatus: number | null): string | null {
  if (failures < POLL_FAILS_BEFORE_BANNER) return null;
  if (lastStatus === 401 || lastStatus === 403) {
    return 'Your session has expired, so this page has stopped updating. Reload the page '
      + 'and sign in again; runs keep going on the server.';
  }
  return 'Lost contact with the server, so this page has stopped updating. Reload the page '
    + '(your session may have expired); runs keep going on the server.';
}
