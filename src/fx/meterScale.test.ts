import { describe, expect, it } from 'vitest';
import { newMeter, stepMeter } from './ballistics';
import { dbFraction, VU_BALLISTICS, VU_PEAK_BALLISTICS } from './meterScale';

describe('dbFraction', () => {
  it('maps full scale to 1 and floors everything at or below -60 dB to 0', () => {
    expect(dbFraction(1)).toBe(1);
    expect(dbFraction(2)).toBe(1);
    expect(dbFraction(0.001)).toBe(0);
    expect(dbFraction(1e-6)).toBe(0);
    expect(dbFraction(0)).toBe(0);
    expect(dbFraction(NaN)).toBe(0);
    expect(dbFraction(-1)).toBe(0);
    expect(dbFraction(Infinity)).toBe(1);
  });

  it('places -30 dB halfway', () => {
    expect(dbFraction(10 ** (-30 / 20))).toBeCloseTo(0.5, 6);
  });
});

describe('VU ballistics', () => {
  it('a 50 ms full-scale spike lifts the peak lid but barely moves the body', () => {
    const body = newMeter();
    const lid = newMeter();
    const dt = 16;
    let now = 0;
    let bodyMax = 0;
    let lidMax = 0;
    for (let i = 0; i < 100; i++) {
      now += dt;
      const target = now <= 50 ? 1 : 0;
      stepMeter(body, target, now, dt, VU_BALLISTICS);
      stepMeter(lid, target, now, dt, VU_PEAK_BALLISTICS);
      bodyMax = Math.max(bodyMax, body.level);
      lidMax = Math.max(lidMax, lid.peak);
    }
    expect(lidMax).toBeGreaterThan(0.9);
    expect(bodyMax).toBeLessThan(0.6);
  });
});
