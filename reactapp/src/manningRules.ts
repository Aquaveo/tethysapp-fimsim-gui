// reactapp/src/manningRules.ts
// FIMSIM-BE15 / FE52 — Manning's n rules, shared by the per-class table and
// the fixed-n fields. ONE enforced limit (HARD_N, mirrored server-side as
// MANNING_N_MIN/MAX in job_types/steps.py — a backend test pins the pair);
// the per-class literature [min, max] only WARNS so sensitivity analyses can
// push a class outside its range.
// 0.15 = the highest literature max in fimcore's tables (Reshma, 2026-10-15).
export const HARD_N = { min: 0.01, max: 0.15 } as const;

export interface ClassRange {
  label: string;
  min: number | null;
  max: number | null;
  default: number | null;
}

/** Pin a value into the hard band (what the table does to an edit). */
export function clampHard(n: number): number {
  return Math.min(HARD_N.max, Math.max(HARD_N.min, n));
}

/** The non-blocking warning for a class value outside its literature range,
 *  or null when inside it (or when the class has no range, e.g. Clouds). */
export function rowWarning(value: number, row: ClassRange): string | null {
  if (row.min === null || row.max === null) return null;
  if (value >= row.min && value <= row.max) return null;
  return `Outside the recommended ${row.min.toFixed(3)}–${row.max.toFixed(3)} range `
    + `for ${row.label} — this will affect your results.`;
}

/** How many EDITED classes in the mapping sit outside their range. */
export function warningCount(
  mapping: Record<string, number> | undefined, rows: Record<string, ClassRange>,
): number {
  if (!mapping) return 0;
  let n = 0;
  for (const [code, v] of Object.entries(mapping)) {
    if (code === 'default') continue;
    const row = rows[code];
    if (row && rowWarning(v, row)) n += 1;
  }
  return n;
}
