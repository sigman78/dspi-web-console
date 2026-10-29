import { BAND_COUNT } from './bands';

/** Source of third-octave band levels for a spectrum display. */
export interface SpectrumFeed {
  readonly kind: 'simulated' | 'rta';
  /** 0..1 display fraction per band; the returned array is reused between calls. */
  bands(nowMs: number): Float32Array;
}

const BPM = 112;
const STEP_MS = 60;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Music-like stand-in: a bass-heavy tilt, per-band mean-reverting random walks
 * and a beat pulse on the low bands, all scaled by the live output level
 * (linear 0..1) so silence sits on the floor.
 */
export function simulatedSpectrum(levelOf: () => number, seed = 7): SpectrumFeed {
  const rand = mulberry32(seed);
  const out = new Float32Array(BAND_COUNT);
  const walk = new Float32Array(BAND_COUNT);
  const shape = new Float32Array(BAND_COUNT);
  for (let i = 0; i < BAND_COUNT; i++) {
    const x = i / (BAND_COUNT - 1);
    // Pink-ish slope with a low-mid hump and a gentle air roll-off.
    shape[i] = 0.9 - 0.55 * x + 0.12 * Math.exp(-(((x - 0.18) / 0.12) ** 2)) - 0.12 * x * x;
  }
  let lastStep = 0;
  return {
    kind: 'simulated',
    bands(nowMs: number): Float32Array {
      const lev = levelOf();
      if (!(lev > 1e-4)) {
        out.fill(0);
        lastStep = nowMs;
        return out;
      }
      // Fixed-rate walk update so motion speed does not depend on frame rate.
      if (nowMs - lastStep > 1000) lastStep = nowMs;
      while (nowMs - lastStep >= STEP_MS) {
        lastStep += STEP_MS;
        for (let i = 0; i < BAND_COUNT; i++) walk[i] += (rand() - 0.5) * 0.32 - walk[i] * 0.14;
      }
      const gain = Math.min(1, Math.max(0, 1 + (20 * Math.log10(lev)) / 54));
      const phase = ((nowMs * BPM) / 60000) % 1;
      const kick = Math.exp(-phase * 7);
      const snare = Math.exp((-((phase + 0.5) % 1) * 9));
      for (let i = 0; i < BAND_COUNT; i++) {
        const low = i < 12 ? 1 - i / 12 : 0;
        const mid = i >= 12 && i < 24 ? 0.5 : 0;
        const v = shape[i] + walk[i] * 0.45 + kick * low * 0.28 + snare * mid * 0.12 - 0.12;
        out[i] = Math.min(1, Math.max(0, v * gain));
      }
      return out;
    },
  };
}
