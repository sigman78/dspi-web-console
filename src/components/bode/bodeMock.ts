// Mock curve generators for the Bode plot showcase: pure math over BODE_FREQS,
// independent of the real biquad converter.

import { BODE_BINS, BODE_FREQS } from './bodeFreqs';
import type { BodeCurve } from './BodePlot.svelte';
import type { ChannelId } from '@/domain';

// Gaussian bump in log-frequency space. Centered at fc, Q-ish width controls
// how sharp the peak is. Returns a function ready to add into a sample loop.
function bump(fc: number, gainDb: number, width: number): (f: number) => number {
  const lc = Math.log(fc);
  const w2 = width * width;
  return (f) => {
    const d = Math.log(f) - lc;
    return gainDb * Math.exp(-(d * d) / w2);
  };
}

// Soft shelf above (kind > 0) or below (kind < 0) a corner frequency.
function shelf(fc: number, gainDb: number, kind: 1 | -1): (f: number) => number {
  const lc = Math.log(fc);
  return (f) => {
    const x = (Math.log(f) - lc) * kind;
    return gainDb * (0.5 + 0.5 * Math.tanh(x * 1.2));
  };
}

function sample(parts: Array<(f: number) => number>): number[] {
  const out = new Array<number>(BODE_BINS);
  for (let i = 0; i < BODE_BINS; i++) {
    let v = 0;
    const f = BODE_FREQS[i];
    for (const p of parts) v += p(f);
    out[i] = v;
  }
  return out;
}

// Single, recognizable EQ-style curve for the Equalizer tab showcase.
export function mockEqCurve(channelId?: ChannelId): BodeCurve {
  return {
    id: 'eq-mock',
    channelId,
    label: 'Mock EQ',
    points: sample([
      bump(80, 6, 0.55),
      bump(2000, -3, 0.45),
      shelf(8000, 2.5, 1),
      shelf(40, -1, -1),
    ]),
  };
}
