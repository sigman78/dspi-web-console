import { describe, test, expect } from 'vitest';
import { BAND_COUNT } from './bands';
import { simulatedSpectrum } from './spectrumFeed';

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
