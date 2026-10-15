// reactapp/src/aoiRules.ts
// #xi (FIMSIM-FE35): one study area per project on the web app (Sagy: online =
// one case study at a time; batch work is the desktop FIMsim's). Mirrors
// ingest.py MAX_AOIS_PER_PROJECT / single_aoi_problem server-side.
export const MAX_AOIS_PER_PROJECT = 1;

/** Adding an area while one exists must be confirmed (it replaces it). */
export function needsReplaceConfirm(aoiCount: number): boolean {
  return aoiCount >= MAX_AOIS_PER_PROJECT;
}

/** The confirm text: names what goes away, step results included. */
export function replaceWarning(aois: { name: string }[]): string {
  const what = aois.length === 1
    ? `"${aois[0].name}"` : `the ${aois.length} study areas in this project`;
  return `This replaces ${what}. All step results computed for it (terrain, roughness, `
    + 'boundaries, flow data, simulation) are deleted with it.';
}

/** A multi-feature upload pre-selects its first feature (single choice). */
export function defaultPick(features: { index: number }[]): number | null {
  return features.length ? features[0].index : null;
}
