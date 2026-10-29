import { describe, test, expect } from 'vitest';
import { SPECTRUM_BALLISTICS as B, newMeter, stepMeter, type MeterState } from './ballistics';

function run(m: MeterState, target: number, fromMs: number, durMs: number, dt = 16) {
  for (let t = fromMs; t < fromMs + durMs; t += dt) stepMeter(m, target, t + dt, dt, B);
  return m;
}

describe('stepMeter', () => {
  test('attacks within a few frames', () => {
    const m = run(newMeter(), 1, 0, 112);
    expect(m.level).toBeGreaterThan(0.95);
  });

  test('releases slowly: about 63% down after one release time constant', () => {
    const m = run(newMeter(), 1, 0, 200);
    const start = m.level;
    run(m, 0, 200, B.releaseMs);
    expect(m.level / start).toBeGreaterThan(0.3);
    expect(m.level / start).toBeLessThan(0.45);
  });

  test('peak cap holds, then falls under gravity but stays above the bar', () => {
    const m = run(newMeter(), 1, 0, 200);
    run(m, 0, 200, B.holdMs - 300);
    expect(m.peak).toBeGreaterThan(0.95);
    run(m, 0, 200 + B.holdMs - 300, 1200);
    expect(m.peak).toBeLessThan(0.6);
    expect(m.peak).toBeGreaterThanOrEqual(m.level);
  });

  test('a new higher level re-arms the hold', () => {
    const m = run(newMeter(), 0.5, 0, 200);
    run(m, 0, 200, 1000);
    run(m, 0.9, 1200, 200);
    expect(m.peak).toBeGreaterThan(0.85);
    run(m, 0, 1400, B.holdMs - 200);
    expect(m.peak).toBeGreaterThan(0.85);
  });
});
