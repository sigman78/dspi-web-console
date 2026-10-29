import { BAND_COUNT, BAND_HZ } from './bands';

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

/** Level range shown, below 0 dBFS: -SPAN dBFS and lower sit on the floor. */
export const RTA_SPAN_DB = 60;

/** Live analyser data, injected so the feed stays free of device types. */
export interface RtaSource {
  /** Firmware band centres in Hz, ascending; band j of a frame sits at index j. */
  centresHz(): readonly number[];
  /** Latest per-channel frames; levelsDb is dBFS per band (-Infinity = floor). */
  frames(): readonly { readonly levelsDb: readonly number[] }[];
}

/** Index of the centre nearest `hz` on a log axis, or -1 for an empty table. */
function nearestBand(centres: readonly number[], hz: number): number {
  let best = -1;
  let bestDist = Infinity;
  const target = Math.log(hz);
  for (let j = 0; j < centres.length; j++) {
    const dist = Math.abs(Math.log(centres[j]) - target);
    if (dist < bestDist) { bestDist = dist; best = j; }
  }
  return best;
}

/**
 * Analyser-backed feed: each display band takes the nearest firmware band by
 * log frequency and the loudest channel wins per band.
 */
export function rtaSpectrum(source: RtaSource): SpectrumFeed {
  const out = new Float32Array(BAND_COUNT);
  const pick = new Int16Array(BAND_COUNT);
  let mappedFor: readonly number[] | null = null;
  return {
    kind: 'rta',
    bands(): Float32Array {
      const centres = source.centresHz();
      if (centres !== mappedFor) {
        mappedFor = centres;
        for (let i = 0; i < BAND_COUNT; i++) pick[i] = nearestBand(centres, BAND_HZ[i]);
      }
      out.fill(-Infinity);
      for (const { levelsDb } of source.frames()) {
        for (let i = 0; i < BAND_COUNT; i++) {
          const j = pick[i];
          if (j >= 0 && j < levelsDb.length && levelsDb[j] > out[i]) out[i] = levelsDb[j];
        }
      }
      for (let i = 0; i < BAND_COUNT; i++) {
        out[i] = Math.min(1, Math.max(0, (out[i] + RTA_SPAN_DB) / RTA_SPAN_DB));
      }
      return out;
    },
  };
}
