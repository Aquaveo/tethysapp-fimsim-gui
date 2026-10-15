// reactapp/src/flowTool.ts
// FIMSIM-FE64 — the Streamflow Data tool's pure helpers: the ID prefill from
// the Area step's lookup (decision 2026-10-15: the tool keeps the Area step
// for exactly this), the rule that keeps a typed value safe, and the pick of
// the per-ID CSVs the tool writes.
import type { ServerAoi } from './api';

export type FlowSource = 'nwm_retro' | 'nwm_forecast' | 'usgs';

/** Gage numbers for USGS; for NWM only the main river's inflow reach —
 *  reach_ids run upstream → downstream, so the first one (what the Flow Data
 *  step resolves). '' when the lookup has none (AOIs looked up before BE25
 *  have no reach_ids). */
export function prefillIds(aoi: Pick<ServerAoi, 'lookup'>, source: FlowSource): string {
  const lookup = aoi.lookup ?? {};
  if (source === 'usgs') return (lookup.gages ?? []).map((g) => g.site_no).join(', ');
  const inflow = (lookup.reach_ids ?? [])[0];
  return inflow === undefined ? '' : String(inflow);
}

/** Re-seed only an untouched field or one still holding the previous seed —
 *  never a value the user typed. */
export function shouldReseed(current: unknown, lastSeed: string | null): boolean {
  return current === undefined || current === lastSeed;
}

const TOOL_CSV = /^(nwm_retro|nwm_forecast|usgs_discharge)_(\d+)\.csv$/i;
const SOURCE_LABEL: Record<string, string> = {
  nwm_retro: 'NWM retro', nwm_forecast: 'NWM forecast', usgs_discharge: 'USGS',
};

/** The Streamflow tool's one-CSV-per-ID outputs, labelled "<source> <id>". */
export function dischargeOutputs(outputs: { name: string }[]): { name: string; label: string }[] {
  return outputs.flatMap((o) => {
    const m = TOOL_CSV.exec(o.name);
    return m ? [{ name: o.name, label: `${SOURCE_LABEL[m[1].toLowerCase()]} ${m[2]}` }] : [];
  });
}
