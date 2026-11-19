// reactapp/src/__tests__/prepared.test.ts — the PreparedPicker's row logic
// and its two API calls (FIMSIM-FE71).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { listPrepared, pickPrepared, type PreparedRow } from '../api';
import { PICKED_HINT, orderRows, rowNote, rowState } from '../prepared';

const row = (over: Partial<PreparedRow> = {}): PreparedRow => ({
  steprun_id: 1, project: 'Lumber prep', aoi: 'AOI_3_Lumber',
  file: 'DEM_3DEP_AOI_3_Lumber.tif', finished: '2026-10-27T15:02:11+00:00',
  detail: 'USGS 3DEP · 10 m', covers: true, usable: true, reason: null, ...over,
});

const jsonRes = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  });

afterEach(() => vi.unstubAllGlobals());

describe('rowState', () => {
  it('is ready when usable and covering the area', () => {
    expect(rowState(row())).toBe('ready');
  });
  it('is uncovered when usable but not covering the area', () => {
    expect(rowState(row({ covers: false }))).toBe('uncovered');
  });
  it('is unusable whenever usable is false, whatever covers says', () => {
    expect(rowState(row({ usable: false, covers: null, reason: 'x' }))).toBe('unusable');
  });
});

describe('rowNote', () => {
  it('is empty for a ready row', () => {
    expect(rowNote(row())).toBe('');
  });
  it('explains an uncovered row', () => {
    expect(rowNote(row({ covers: false }))).toBe(
      'Does not cover this area — re-run the tool on an area that contains it.');
  });
  it("shows the server's reason for an unusable row", () => {
    expect(rowNote(row({ usable: false, covers: null, reason: 'HAND is height above…' })))
      .toBe('HAND is height above…');
  });
});

describe('orderRows', () => {
  it('puts ready rows first and keeps the server order (newest first) inside each group', () => {
    const a = row({ steprun_id: 1, covers: false });
    const b = row({ steprun_id: 2 });
    const c = row({ steprun_id: 3, usable: false, covers: null, reason: 'r' });
    const d = row({ steprun_id: 4 });
    expect(orderRows([a, b, c, d]).map((r) => r.steprun_id)).toEqual([2, 4, 1, 3]);
  });
});

describe('prepared-input API', () => {
  it('lists with the kind as a query parameter', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonRes({ prepared: [row()] }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(listPrepared(54, 'dem')).resolves.toEqual([row()]);
    expect(fetchMock.mock.calls[0][0]).toBe('/apps/fimsim-gui/api/aois/54/prepared/?kind=dem');
  });

  it('picks with a JSON POST of {steprun_id, file, kind}', async () => {
    document.cookie = 'csrftoken=tok123';
    const picked = {
      key: 'u/1/54/user_dem/DEM_3DEP_AOI_3_Lumber.tif', name: 'DEM_3DEP_AOI_3_Lumber.tif',
      bytes: 10, source: { steprun_id: 1, project: 'Lumber prep', aoi: 'AOI_3_Lumber' },
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 200 })) // csrf (maybe cached)
      .mockResolvedValue(jsonRes(picked));
    vi.stubGlobal('fetch', fetchMock);
    await expect(pickPrepared(54, { steprun_id: 1, file: picked.name, kind: 'dem' }))
      .resolves.toEqual(picked);
    const call = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/prepared/'));
    expect(call?.[1]?.method).toBe('POST');
    expect(JSON.parse(String(call?.[1]?.body))).toEqual(
      { steprun_id: 1, file: picked.name, kind: 'dem' });
  });
});

// 2026-10-29: after "Use this", the "Prepared: …" line read as if the step
// were done; the user moved on to Roughness without running Terrain.
describe('PICKED_HINT', () => {
  it('says the step still has to be run, naming the button', () => {
    expect(PICKED_HINT).toMatch(/not run yet/i);
    expect(PICKED_HINT).toMatch(/Run this step/);
  });
});
