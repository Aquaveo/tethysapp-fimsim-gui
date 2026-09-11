// reactapp/src/__tests__/aoiMap.test.ts — bboxRing, AoiMap's pure draw helper.
// maplibre-gl (and its worker-URL import) is mocked: importing AoiMap runs
// module-level map setup we don't want in jsdom.
import { describe, expect, it, vi } from 'vitest';

vi.mock('maplibre-gl', () => ({ setWorkerUrl: vi.fn() }));
vi.mock('maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url', () => ({ default: '' }));

const { bboxRing } = await import('../AoiMap');

describe('bboxRing', () => {
  it('turns scattered points into their closed 5-point enclosing rectangle', () => {
    const ring = bboxRing([[-100, 36], [-99.2, 35.1], [-99.8, 35.6], [-99.5, 36.4]]);
    expect(ring).toEqual([
      [-100, 35.1], [-99.2, 35.1], [-99.2, 36.4], [-100, 36.4], [-100, 35.1],
    ]);
  });

  it('closes the ring (first point repeated last) and stays axis-aligned', () => {
    const ring = bboxRing([[1, 2], [3, 4]]);
    expect(ring).toHaveLength(5);
    expect(ring[0]).toEqual(ring[4]);
    expect(ring).toEqual([[1, 2], [3, 2], [3, 4], [1, 4], [1, 2]]);
  });

  it('degenerates gracefully for a single point (zero-size box, still closed)', () => {
    expect(bboxRing([[5, 6]])).toEqual([[5, 6], [5, 6], [5, 6], [5, 6], [5, 6]]);
  });
});
