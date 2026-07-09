import { describe, it, expect } from 'vitest';
import { centeredDbDomain } from './dbDomain';

describe('centeredDbDomain', () => {
  it('widens a flat curve to at least minSpan, centered on the value plus padding', () => {
    const flat = new Array(201).fill(3);
    const [lo, hi] = centeredDbDomain([flat], 10, 0.2);
    expect(hi - lo).toBeGreaterThanOrEqual(10);
    expect((lo + hi) / 2).toBeCloseTo(3, 6);
  });

  it('spans a wide curve plus padding beyond the data range', () => {
    const wide = [-20, 0, 20];
    const [lo, hi] = centeredDbDomain([wide], 10, 0.2);
    expect(lo).toBeLessThan(-20);
    expect(hi).toBeGreaterThan(20);
  });
});
