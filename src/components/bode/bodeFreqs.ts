// Canonical frequency grid for the Bode plot: 201 log-spaced bins inclusive
// of 20 Hz and 20 kHz. Plot and filter-response converter sample at these
// exact frequencies, so a curve produced anywhere renders without resampling.

import { Eq } from '@/domain';

export const BODE_BINS = 201;
export const BODE_FMIN = Eq.FREQ_MIN_HZ;
export const BODE_FMAX = Eq.FREQ_MAX_HZ;

export const BODE_FREQS: readonly number[] = (() => {
  const out = new Array<number>(BODE_BINS);
  const lmin = Math.log(BODE_FMIN);
  const lspan = Math.log(BODE_FMAX) - lmin;
  for (let i = 0; i < BODE_BINS; i++) {
    out[i] = Math.exp(lmin + (lspan * i) / (BODE_BINS - 1));
  }
  return out;
})();

// Map a frequency in Hz to a normalized x in [0, 1] across the log axis.
export function xNormForF(f: number): number {
  return Math.log(f / BODE_FMIN) / Math.log(BODE_FMAX / BODE_FMIN);
}

// Inverse: pixel/normalized x in [0, 1] -> Hz on the log axis.
export function fForXNorm(x: number): number {
  return BODE_FMIN * Math.pow(BODE_FMAX / BODE_FMIN, x);
}
