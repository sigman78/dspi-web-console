import { describe, test, expect } from 'vitest';
import { BAND_COUNT, BAND_HZ } from './bands';
import { RTA_SPAN_DB, rtaSpectrum, simulatedSpectrum } from './spectrumFeed';

function meanOver(level: number, ms = 4000): number {
  const feed = simulatedSpectrum(() => level);
  let sum = 0;
  let n = 0;
  for (let t = 0; t < ms; t += 16) {
    for (const v of feed.bands(t)) { sum += v; n++; }
  }
  return sum / n;
}

describe('simulatedSpectrum', () => {
  test('is flat zero at silence', () => {
    const feed = simulatedSpectrum(() => 0);
    for (let t = 0; t < 1000; t += 50) expect(Math.max(...feed.bands(t))).toBe(0);
  });

  test('rises with the output level and stays within 0..1', () => {
    expect(meanOver(0.8)).toBeGreaterThan(meanOver(0.05) + 0.2);
    const feed = simulatedSpectrum(() => 1);
    for (let t = 0; t < 3000; t += 16) {
      const b = feed.bands(t);
      expect(b).toHaveLength(BAND_COUNT);
      expect(Math.min(...b)).toBeGreaterThanOrEqual(0);
      expect(Math.max(...b)).toBeLessThanOrEqual(1);
    }
  });

  test('is bass-heavy, like music', () => {
    const feed = simulatedSpectrum(() => 0.7);
    let low = 0;
    let high = 0;
    for (let t = 0; t < 4000; t += 16) {
      const b = feed.bands(t);
      for (let i = 0; i < 8; i++) { low += b[i]; high += b[BAND_COUNT - 1 - i]; }
    }
    expect(low).toBeGreaterThan(high);
  });
});

const CENTRES_48K = [
  10, 13, 16, 20, 25, 32, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800,
  1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000,
];
const CENTRES_96K = [...CENTRES_48K, 25000, 31500, 40000];

function levelsAt(centres: readonly number[], hz: number, db: number): number[] {
  return centres.map((c) => (c === hz ? db : -Infinity));
}

function bandNear(hz: number): number {
  return BAND_HZ.findIndex((f) => Math.abs(Math.log(f / hz)) < 0.01);
}

describe('rtaSpectrum', () => {
  for (const [name, centres] of [['48k', CENTRES_48K], ['96k', CENTRES_96K]] as const) {
    test(`lights only the display band nearest a firmware band (${name} table)`, () => {
      const feed = rtaSpectrum({ centresHz: () => centres, frames: () => [{ levelsDb: levelsAt(centres, 1000, -15) }] });
      const out = feed.bands(0);
      const hit = bandNear(1000);
      expect(out[hit]).toBeCloseTo((RTA_SPAN_DB - 15) / RTA_SPAN_DB);
      out.forEach((v, i) => { if (i !== hit) expect(v).toBe(0); });
    });
  }

  test('ignores firmware bands above the display range', () => {
    const feed = rtaSpectrum({ centresHz: () => CENTRES_96K, frames: () => [{ levelsDb: levelsAt(CENTRES_96K, 25000, 0) }] });
    expect(Math.max(...feed.bands(0))).toBe(0);
    const top = rtaSpectrum({ centresHz: () => CENTRES_96K, frames: () => [{ levelsDb: levelsAt(CENTRES_96K, 20000, 0) }] });
    expect(top.bands(0)[BAND_COUNT - 1]).toBe(1);
  });

  test('takes the loudest channel per band, not a sum', () => {
    const a = levelsAt(CENTRES_48K, 1000, -40);
    const b = levelsAt(CENTRES_48K, 1000, -20);
    const feed = rtaSpectrum({ centresHz: () => CENTRES_48K, frames: () => [{ levelsDb: a }, { levelsDb: b }] });
    expect(feed.bands(0)[bandNear(1000)]).toBeCloseTo((RTA_SPAN_DB - 20) / RTA_SPAN_DB);
  });

  test('clamps to 0..1 and treats floor, quiet and absent data as 0', () => {
    const loud = rtaSpectrum({ centresHz: () => CENTRES_48K, frames: () => [{ levelsDb: levelsAt(CENTRES_48K, 1000, +6) }] });
    expect(loud.bands(0)[bandNear(1000)]).toBe(1);
    const quiet = rtaSpectrum({ centresHz: () => CENTRES_48K, frames: () => [{ levelsDb: levelsAt(CENTRES_48K, 1000, -90) }] });
    expect(Math.max(...quiet.bands(0))).toBe(0);
    const none = rtaSpectrum({ centresHz: () => CENTRES_48K, frames: () => [] });
    expect(Math.max(...none.bands(0))).toBe(0);
    const noTable = rtaSpectrum({ centresHz: () => [], frames: () => [{ levelsDb: [-10, -10] }] });
    expect(Math.max(...noTable.bands(0))).toBe(0);
  });

  test('remaps when the centre table is replaced', () => {
    let centres: readonly number[] = CENTRES_48K;
    const frame = [-10, -10, -10];
    const feed = rtaSpectrum({ centresHz: () => centres, frames: () => [{ levelsDb: frame }] });
    const first = Array.from(feed.bands(0));
    centres = [20000, 10, 1000];
    const second = Array.from(feed.bands(1));
    expect(second).not.toEqual(first);
    expect(second[bandNear(1000)]).toBeGreaterThan(0);
  });
});
