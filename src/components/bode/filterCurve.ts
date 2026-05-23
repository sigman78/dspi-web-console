import { FilterType, type FilterParams } from '@/domain';
import { BODE_BINS, BODE_FREQS } from './bodeFreqs';

// Sample rate the biquad coefficients are computed at.
// TODO(eq-state): once dsp.draft exposes a stable Fs field, source from
// there. 48 kHz vs 96 kHz only changes the response above ~15 kHz; for the
// audio-band shapes we render this is invisible.
export const EQ_SAMPLE_RATE = 48000;

const TWO_PI = Math.PI * 2;
const LN10 = Math.log(10);

interface Coeffs {
  b0: number; b1: number; b2: number;
  a1: number; a2: number;
}

// RBJ Audio EQ Cookbook biquads, normalized so a0 = 1.
function coeffsFor(type: FilterType, f: number, q: number, gainDb: number, fs: number): Coeffs | null {
  if (type === FilterType.Flat) return null;
  const w0 = TWO_PI * f / fs;
  const cosw0 = Math.cos(w0);
  const sinw0 = Math.sin(w0);
  const alpha = sinw0 / (2 * Math.max(0.001, q));

  if (type === FilterType.Peaking) {
    const A = Math.pow(10, gainDb / 40);
    const a0 = 1 + alpha / A;
    return {
      b0: (1 + alpha * A) / a0,
      b1: (-2 * cosw0) / a0,
      b2: (1 - alpha * A) / a0,
      a1: (-2 * cosw0) / a0,
      a2: (1 - alpha / A) / a0,
    };
  }
  if (type === FilterType.LowShelf) {
    const A = Math.pow(10, gainDb / 40);
    const sqrtA2alpha = 2 * Math.sqrt(A) * alpha;
    const a0 = (A + 1) + (A - 1) * cosw0 + sqrtA2alpha;
    return {
      b0: (A * ((A + 1) - (A - 1) * cosw0 + sqrtA2alpha)) / a0,
      b1: (2 * A * ((A - 1) - (A + 1) * cosw0)) / a0,
      b2: (A * ((A + 1) - (A - 1) * cosw0 - sqrtA2alpha)) / a0,
      a1: (-2 * ((A - 1) + (A + 1) * cosw0)) / a0,
      a2: ((A + 1) + (A - 1) * cosw0 - sqrtA2alpha) / a0,
    };
  }
  if (type === FilterType.HighShelf) {
    const A = Math.pow(10, gainDb / 40);
    const sqrtA2alpha = 2 * Math.sqrt(A) * alpha;
    const a0 = (A + 1) - (A - 1) * cosw0 + sqrtA2alpha;
    return {
      b0: (A * ((A + 1) + (A - 1) * cosw0 + sqrtA2alpha)) / a0,
      b1: (-2 * A * ((A - 1) + (A + 1) * cosw0)) / a0,
      b2: (A * ((A + 1) + (A - 1) * cosw0 - sqrtA2alpha)) / a0,
      a1: (2 * ((A - 1) - (A + 1) * cosw0)) / a0,
      a2: ((A + 1) - (A - 1) * cosw0 - sqrtA2alpha) / a0,
    };
  }
  if (type === FilterType.LowPass) {
    const a0 = 1 + alpha;
    return {
      b0: ((1 - cosw0) / 2) / a0,
      b1: (1 - cosw0) / a0,
      b2: ((1 - cosw0) / 2) / a0,
      a1: (-2 * cosw0) / a0,
      a2: (1 - alpha) / a0,
    };
  }
  if (type === FilterType.HighPass) {
    const a0 = 1 + alpha;
    return {
      b0: ((1 + cosw0) / 2) / a0,
      b1: (-(1 + cosw0)) / a0,
      b2: ((1 + cosw0) / 2) / a0,
      a1: (-2 * cosw0) / a0,
      a2: (1 - alpha) / a0,
    };
  }
  return null;
}

// |H(e^jw)| in dB for one biquad section at frequency f.
function magDbAt(c: Coeffs, w: number): number {
  const cw = Math.cos(w), sw = Math.sin(w);
  const c2w = Math.cos(2 * w), s2w = Math.sin(2 * w);
  // numerator b0 + b1 e^-jw + b2 e^-2jw
  const numRe = c.b0 + c.b1 * cw + c.b2 * c2w;
  const numIm = -(c.b1 * sw + c.b2 * s2w);
  // denominator 1 + a1 e^-jw + a2 e^-2jw
  const denRe = 1 + c.a1 * cw + c.a2 * c2w;
  const denIm = -(c.a1 * sw + c.a2 * s2w);
  const num2 = numRe * numRe + numIm * numIm;
  const den2 = denRe * denRe + denIm * denIm;
  // 10*log10(|num|^2 / |den|^2) -- half the multiplications of taking sqrt first.
  return (10 / LN10) * Math.log(num2 / den2);
}

// Sum the dB response of every (non-Flat) band, plus the preamp.
// Pure function: same input -> same output. Length is always BODE_BINS.
export function filterCurve(bands: ReadonlyArray<FilterParams>, preampDb: number): number[] {
  const fs = EQ_SAMPLE_RATE;
  const out = new Array<number>(BODE_BINS);
  for (let i = 0; i < BODE_BINS; i++) out[i] = preampDb;
  for (const band of bands) {
    const c = coeffsFor(band.type, band.frequency, band.q, band.gain, fs);
    if (!c) continue;
    for (let i = 0; i < BODE_BINS; i++) {
      const w = TWO_PI * BODE_FREQS[i] / fs;
      out[i] += magDbAt(c, w);
    }
  }
  return out;
}

// Cumulative dB at a single frequency. Mirrors filterCurve so band markers
// can be placed on the rendered line instead of on the parameter `gain`,
// which is wrong for overlapping bands, shelves (gain/2 at corner), and
// HP/LP (no gain parameter).
export function filterCurveAt(
  bands: ReadonlyArray<FilterParams>,
  preampDb: number,
  f: number,
): number {
  const fs = EQ_SAMPLE_RATE;
  const w = TWO_PI * f / fs;
  let db = preampDb;
  for (const band of bands) {
    const c = coeffsFor(band.type, band.frequency, band.q, band.gain, fs);
    if (!c) continue;
    db += magDbAt(c, w);
  }
  return db;
}
