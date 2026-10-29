import { describe, expect, it } from 'vitest';
import { layoutMeters } from './meterLayout';

describe('layoutMeters', () => {
  it('centres a pair and caps the slab width', () => {
    const { slabW, x } = layoutMeters([0, 0], 1200);
    expect(slabW).toBe(112);
    expect(x[0] + (x[1] + slabW)).toBeCloseTo(1200, 3);
  });

  it('spans the whole wall when nine channels are width-bound, with a tighter gap inside a pair', () => {
    const width = 600;
    const { slabW, x } = layoutMeters([0, 0, 1, 1, 2, 2, 3, 3, 4], width);
    expect(slabW).toBeLessThan(112);
    expect(x[0]).toBeCloseTo(0, 3);
    expect(x[8] + slabW).toBeCloseTo(width, 3);
    const intraGap = x[1] - (x[0] + slabW);
    const interGap = x[2] - (x[1] + slabW);
    expect(intraGap).toBeLessThan(interGap);
  });

  it('keeps the minimum slab width on a very narrow wall and overflows evenly', () => {
    const { slabW, x } = layoutMeters([0, 0, 1, 1, 2, 2, 3, 3, 4], 100);
    expect(slabW).toBe(14);
    expect(x[0]).toBeLessThan(0);
  });

  it('returns an empty layout for no slots', () => {
    const l = layoutMeters([], 500);
    expect(l.slabW).toBe(0);
    expect(l.x).toHaveLength(0);
  });
});
