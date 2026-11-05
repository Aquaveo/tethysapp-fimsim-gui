// reactapp/src/prepared.ts
// Row logic for the PreparedPicker (FIMSIM-FE71): which of the user's tool
// outputs can be used in this area, and why not.
import type { PreparedKind, PreparedRow } from './api';

/**
 * Which prepared-input kind a modeling step's current input choice asks for
 * (FE72), or null when the step downloads its data. Terrain picks a DEM;
 * Roughness a Manning's n grid or a land cover (BE22); Flow Data a
 * streamflow series (BE23).
 */
export function preparedKindFor(
  stepKey: string, get: (key: string) => unknown,
): PreparedKind | null {
  switch (stepKey) {
    case 'dem':
    case 'tdem':
      return get('dem_input') === 'prepared' ? 'dem' : null;
    case 'manning':
    case 'tfric': {
      const input = get('manning_input');
      return input === 'prepared_manning' ? 'manning'
        : input === 'prepared_lulc' ? 'lulc' : null;
    }
    case 'bdy':
    case 'thyg':
      return get('bdy_source') === 'prepared' ? 'flow' : null;
    default:
      return null;
  }
}

/** What the user picks, in the "Pick a prepared … for:" submit message. */
export const PICK_NOUN: Record<PreparedKind, string> = {
  dem: 'DEM', manning: "Manning's n grid", lulc: 'land cover', flow: 'streamflow series',
};

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
