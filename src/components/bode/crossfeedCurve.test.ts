import { describe, it, expect } from 'vitest';
import { crossfeedResponse } from './crossfeedCurve';
import { BODE_FREQS } from './bodeFreqs';

describe('crossfeedResponse', () => {
  it('returns 201-length arrays for both curves', () => {
    const { crossfeed, direct } = crossfeedResponse(700, 4.5);
    expect(crossfeed.length).toBe(BODE_FREQS.length);
    expect(direct.length).toBe(BODE_FREQS.length);
  });

  it('crossfeed sits near 20*log10(G) at the lowest frequency and rolls off relative to direct at the highest', () => {
    const feedDb = 4.5;
    const { crossfeed, direct } = crossfeedResponse(700, feedDb);
    const levelRatio = Math.pow(10, feedDb / 20);
    const G = 1 / (1 + levelRatio);
    const expectedLow = 20 * Math.log10(G);

    expect(crossfeed[0]).toBeCloseTo(expectedLow, 0);
    expect(direct[0]).toBeLessThan(0);

    const last = crossfeed.length - 1;
    expect(crossfeed[0]).toBeGreaterThan(crossfeed[last]);
    expect(direct[last]).toBeGreaterThan(direct[0]);
    expect(direct[last]).toBeGreaterThan(crossfeed[last]);
  });
});
