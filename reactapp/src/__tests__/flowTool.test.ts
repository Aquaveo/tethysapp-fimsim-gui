// reactapp/src/__tests__/flowTool.test.ts — FIMSIM-FE64: the Streamflow
// tool's ID prefill from the area lookup, its reseed rule, and the CSV pick.
import { describe, expect, it } from 'vitest';
import { dischargeOutputs, prefillIds, shouldReseed } from '../flowTool';

const aoi = {
  lookup: {
    gages: [{ site_no: '02134170', station_nm: 'LUMBER', lat: 34.6, lon: -79 },
            { site_no: '02134500', station_nm: 'LUMBER 2', lat: 34.7, lon: -79 }],
    reach_ids: [8781135, 8781137],
  },
};

describe('prefillIds', () => {
  it('suggests the gage numbers for USGS and the main-river reaches for NWM', () => {
    expect(prefillIds(aoi, 'usgs')).toBe('02134170, 02134500');
    expect(prefillIds(aoi, 'nwm_retro')).toBe('8781135, 8781137');
    expect(prefillIds(aoi, 'nwm_forecast')).toBe('8781135, 8781137');
  });
  it('is empty when the lookup has nothing (older AOIs lack reach_ids)', () => {
    expect(prefillIds({ lookup: { gages: [] } }, 'nwm_retro')).toBe('');
    expect(prefillIds({ lookup: null }, 'usgs')).toBe('');
  });
});

// Review Focus 5: a typed value is never overwritten by a source switch
describe('shouldReseed', () => {
  it('seeds an untouched field and re-seeds one still holding the last seed', () => {
    expect(shouldReseed(undefined, null)).toBe(true);
    expect(shouldReseed('02134170, 02134500', '02134170, 02134500')).toBe(true);
    expect(shouldReseed('', '')).toBe(true);
  });
  it('never replaces what the user typed', () => {
    expect(shouldReseed('02134170', '02134170, 02134500')).toBe(false);
    expect(shouldReseed('8781135', null)).toBe(false);
  });
});

describe('dischargeOutputs', () => {
  it('picks the tool\'s per-ID CSVs with a readable label, in order', () => {
    const outs = [{ name: 'nwm_retro_8781135.csv' }, { name: 'preview.png' },
                  { name: 'usgs_discharge_02134170.csv' }, { name: 'nwm_forecast_12.csv' }];
    expect(dischargeOutputs(outs)).toEqual([
      { name: 'nwm_retro_8781135.csv', label: 'NWM retro 8781135' },
      { name: 'usgs_discharge_02134170.csv', label: 'USGS 02134170' },
      { name: 'nwm_forecast_12.csv', label: 'NWM forecast 12' },
    ]);
  });
  it('ignores the LISFLOOD flow step\'s CSV names (those keep the old single-CSV path)', () => {
    expect(dischargeOutputs([{ name: 'NWM_8781135_discharge.csv' }])).toEqual([]);
  });
});
