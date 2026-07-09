import { describe, it, expect } from 'vitest';
import { loudnessResponse } from './loudnessCurve';
import { BODE_FREQS } from './bodeFreqs';

describe('loudnessResponse', () => {
  it('returns a 201-length array', () => {
    const gains = loudnessResponse(85, 50);
    expect(gains.length).toBe(BODE_FREQS.length);
  });

  it('is all-zero when intensity is 0', () => {
    const gains = loudnessResponse(85, 0);
    for (const g of gains) expect(g).toBeCloseTo(0, 6);
  });

  it('boosts bass more than ~1 kHz at high refSpl and full intensity', () => {
    const gains = loudnessResponse(100, 100);
    const lowIdx = 0; // 20 Hz
    const midIdx = BODE_FREQS.findIndex((f) => f >= 1000);
    expect(gains[lowIdx]).toBeGreaterThan(0);
    expect(gains[lowIdx]).toBeGreaterThan(gains[midIdx]);
  });
});
