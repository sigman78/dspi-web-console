import type { Ballistics } from './ballistics';

/** Meter floor: -60 dBFS maps to 0, 0 dBFS to 1. */
export const VU_SPAN_DB = 60;

/** A dbFraction() value at or above which a sample counts as clipping (about -0.3 dBFS on the 60 dB span). */
export const CLIP_DB_FRACTION = 0.995;

/** Body of a VU pillar: slow, averaging feel. */
export const VU_BALLISTICS: Ballistics = { attackMs: 90, releaseMs: 450, holdMs: 0, gravityPerS: 2 };

/** Peak lid: fed the raw fraction so its peak tracks true sample peaks. */
export const VU_PEAK_BALLISTICS: Ballistics = { attackMs: 1, releaseMs: 1, holdMs: 1500, gravityPerS: 0.45 };

/** Linear peak (0..1+) to a 0..1 fraction of the dB span. */
export function dbFraction(peakLinear: number): number {
  if (peakLinear >= 1) return 1;
  if (!(peakLinear > 0)) return 0;
  const f = (20 * Math.log10(peakLinear) + VU_SPAN_DB) / VU_SPAN_DB;
  return f < 0 ? 0 : f;
}
