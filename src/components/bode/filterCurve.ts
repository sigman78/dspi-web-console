import { FilterType, QP_DEFAULT, type FilterParams } from '@/domain';
import { BODE_BINS, BODE_FREQS } from './bodeFreqs';
import { xoverSectionCoeffs } from './xoverCurve';

// Sample rate the biquad coefficients are computed at.
// TODO(eq-state): once mirror.current exposes a stable Fs field, source from
// there. 48 kHz vs 96 kHz only changes the response above ~15 kHz; for the
// audio-band shapes we render this is invisible.
export const EQ_SAMPLE_RATE = 48000;

const TWO_PI = Math.PI * 2;
const LN10 = Math.log(10);

export interface BiquadCoeffs {
  b0: number; b1: number; b2: number;
  a1: number; a2: number;
}
type Coeffs = BiquadCoeffs;

// RBJ Audio EQ Cookbook biquads, normalized so a0 = 1. `gainDb` doubles as
// the Linkwitz Transform's fp (Hz, not dB) and `qp` as its Qp -- see
// FilterType.LinkwitzTransform's doc comment.
function coeffsFor(type: FilterType, f: number, q: number, gainDb: number, fs: number, qp?: number): Coeffs | null {
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
  if (type === FilterType.Notch) {
    const a0 = 1 + alpha;
    return {
      b0: 1 / a0,
      b1: (-2 * cosw0) / a0,
      b2: 1 / a0,
      a1: (-2 * cosw0) / a0,
      a2: (1 - alpha) / a0,
    };
  }
  if (type === FilterType.Allpass || type === FilterType.Allpass1) {
    // Allpasses: flat magnitude (0 dB everywhere). Returning null causes
    // filterCurve to contribute 0 dB from this band, which is correct.
    return null;
  }
  // First-order shelves (V16+), firmware-exact forms (dsp_pipeline.c):
  // LowShelf1 has DC gain A^2 and unity at Nyquist; HighShelf1 the mirror.
  if (type === FilterType.LowShelf1) {
    const A = Math.pow(10, gainDb / 40);
    const a0 = (sinw0 / A) + 1 + cosw0;
    return {
      b0: ((A * sinw0) + 1 + cosw0) / a0,
      b1: ((A * sinw0) - 1 - cosw0) / a0,
      b2: 0,
      a1: ((sinw0 / A) - 1 - cosw0) / a0,
      a2: 0,
    };
  }
  if (type === FilterType.HighShelf1) {
    const A = Math.pow(10, gainDb / 40);
    const a0 = sinw0 + (1 / A) + (cosw0 / A);
    return {
      b0: (sinw0 + A + (A * cosw0)) / a0,
      b1: (sinw0 - A - (A * cosw0)) / a0,
      b2: 0,
      a1: (sinw0 - (1 / A) - (cosw0 / A)) / a0,
      a2: 0,
    };
  }
  // Linkwitz Transform (V22+): replaces the measured sealed-box rolloff
  // (f0, Q0 -- this section's `f`/`q`) with a target alignment (fp, Qp).
  // `gainDb` carries fp in Hz; fp <= 0 is firmware's "flat" (no LT effect).
  // Both corners are prewarped independently (sample-exact match to the
  // firmware's digital design), unlike the analog-prototype forms above.
  if (type === FilterType.LinkwitzTransform) {
    const fp = gainDb;
    if (fp <= 0) return null;
    const q0 = Math.max(0.001, q);
    const qpVal = qp === undefined || qp === 0 ? QP_DEFAULT : qp;
    const g0 = Math.tan(Math.PI * f / fs);
    const gp = Math.tan(Math.PI * fp / fs);
    const b0 = 1 + g0 / q0 + g0 * g0;
    const b1 = 2 * (g0 * g0 - 1);
    const b2 = 1 - g0 / q0 + g0 * g0;
    const a0 = 1 + gp / qpVal + gp * gp;
    const a1 = 2 * (gp * gp - 1);
    const a2 = 1 - gp / qpVal + gp * gp;
    return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
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

// Every active section (PEQ biquads + crossover cascades) for the given bands.
function sectionsFor(
  bands: ReadonlyArray<FilterParams>,
  xoverBands: ReadonlyArray<FilterParams>,
  fs: number,
): Coeffs[] {
  const out: Coeffs[] = [];
  for (const band of bands) {
    if (band.bypass) continue;
    const c = coeffsFor(band.type, band.frequency, band.q, band.gain, fs, band.qp);
    if (c) out.push(c);
  }
  for (const band of xoverBands) {
    if (band.bypass) continue;
    out.push(...xoverSectionCoeffs(band.type, band.frequency, fs));
  }
  return out;
}

// Sum the dB response of every (non-Flat) band, plus the preamp. Crossover
// bands (output channels, V16+) contribute their full section cascade.
// Pure function: same input -> same output. Length is always BODE_BINS.
export function filterCurve(
  bands: ReadonlyArray<FilterParams>,
  preampDb: number,
  xoverBands: ReadonlyArray<FilterParams> = [],
): number[] {
  const fs = EQ_SAMPLE_RATE;
  const out = new Array<number>(BODE_BINS);
  for (let i = 0; i < BODE_BINS; i++) out[i] = preampDb;
  for (const c of sectionsFor(bands, xoverBands, fs)) {
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
  xoverBands: ReadonlyArray<FilterParams> = [],
): number {
  const fs = EQ_SAMPLE_RATE;
  const w = TWO_PI * f / fs;
  let db = preampDb;
  for (const c of sectionsFor(bands, xoverBands, fs)) db += magDbAt(c, w);
  return db;
}
