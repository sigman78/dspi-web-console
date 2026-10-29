import { describe, test, expect } from 'vitest';
import { BAND_COUNT } from './bands';
import { GreetingWave } from './greetingWave';

const silence = new Float32Array(BAND_COUNT);

function argmax(a: Float32Array): number {
  let best = 0;
  for (let i = 1; i < a.length; i++) if (a[i] > a[best]) best = i;
  return best;
}

describe('GreetingWave', () => {
  test('passes bands through untouched until started', () => {
    const wave = new GreetingWave();
    expect(wave.apply(0, silence)).toBe(silence);
  });

  test('sweeps from bass to treble once, then goes quiet', () => {
    const wave = new GreetingWave();
    wave.start(0);
    let lastPeak = -1;
    let lit = 0;
    for (let t = 0; t < 3000; t += 16) {
      const out = wave.apply(t, silence);
      if (Math.max(...out) < 0.01) continue;
      lit++;
      const peak = argmax(out);
      expect(peak).toBeGreaterThanOrEqual(lastPeak);
      lastPeak = peak;
    }
    expect(lit).toBeGreaterThan(10);
    expect(lastPeak).toBe(BAND_COUNT - 1);
    expect(Math.max(...wave.apply(3000, silence))).toBe(0);
  });

  test('leaves bands louder than the wave as they are', () => {
    const wave = new GreetingWave();
    const loud = new Float32Array(BAND_COUNT).fill(0.9);
    wave.start(0);
    for (let t = 0; t < 1500; t += 16) {
      for (const v of wave.apply(t, loud)) expect(v).toBe(loud[0]);
    }
  });

  test('waits for a start time in the future', () => {
    const wave = new GreetingWave();
    wave.start(500);
    expect(Math.max(...wave.apply(400, silence))).toBe(0);
    expect(Math.max(...wave.apply(1000, silence))).toBeGreaterThan(0.01);
  });
});
