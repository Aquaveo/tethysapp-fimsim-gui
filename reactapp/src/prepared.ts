// reactapp/src/prepared.ts
// Row logic for the PreparedPicker (FIMSIM-FE71): which of the user's tool
// outputs can be used in this area, and why not.
import type { PreparedRow } from './api';

export type RowState = 'ready' | 'uncovered' | 'unusable';

export const rowState = (r: PreparedRow): RowState =>
  !r.usable ? 'unusable' : r.covers ? 'ready' : 'uncovered';

export const UNCOVERED_NOTE =
  'Does not cover this area — re-run the tool on an area that contains it.';

export function rowNote(r: PreparedRow): string {
  const state = rowState(r);
  if (state === 'unusable') return r.reason ?? 'Not usable here.';
  return state === 'uncovered' ? UNCOVERED_NOTE : '';
}

/** Ready rows first; the server's newest-first order is kept inside each group. */
export function orderRows(rows: PreparedRow[]): PreparedRow[] {
  const rank: Record<RowState, number> = { ready: 0, uncovered: 1, unusable: 2 };
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => rank[rowState(a.r)] - rank[rowState(b.r)] || a.i - b.i)
    .map(({ r }) => r);
}

/** Shown under a picked file: picking only copies it, the step still has to run. */
export const PICKED_HINT =
  'Copied into this area, but the step has not run yet: press "Run this step" above '
  + 'to use it.';
