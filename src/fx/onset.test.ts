import { describe, expect, it } from 'vitest';
import { OnsetDetector } from './onset';

const db = (d: number): number => 10 ** (d / 20);

/** Feeds a steady bed at `bedDb` every 50 ms from t=0 up to (not including) `untilMs`. */
function settle(d: OnsetDetector, bedDb: number, untilMs: number): void {
  for (let t = 0; t < untilMs; t += 50) d.sample(db(bedDb), t);
}

describe('OnsetDetector', () => {
  it('fires on a sharp jump over a steady bed', () => {
    const d = new OnsetDetector();
    settle(d, -30, 1000);
    expect(d.sample(db(-15), 1000)).toBeGreaterThan(0);
  });

  it('stays quiet on a steady level', () => {
    const d = new OnsetDetector();
    let fired = 0;
    for (let t = 0; t < 3000; t += 50) fired += d.sample(db(-20), t) > 0 ? 1 : 0;
    expect(fired).toBe(0);
  });

  it('ignores a slow swell of the same size', () => {
    const d = new OnsetDetector();
    settle(d, -30, 1000);
    let fired = 0;
    for (let k = 0; k <= 40; k++) fired += d.sample(db(-30 + (15 * k) / 40), 1000 + k * 50) > 0 ? 1 : 0;
    expect(fired).toBe(0);
  });

  it('holds off a second hit 60 ms later but allows one 200 ms later', () => {
    const d = new OnsetDetector();
    settle(d, -40, 1000);
    expect(d.sample(db(-15), 1000)).toBeGreaterThan(0);
    expect(d.sample(db(-5), 1060)).toBe(0);
    d.sample(db(-40), 1100);
    d.sample(db(-40), 1150);
    expect(d.sample(db(-10), 1200)).toBeGreaterThan(0);
  });

  it('does not fire below the floor', () => {
    const d = new OnsetDetector();
    settle(d, -80, 1000);
    expect(d.sample(db(-60), 1000)).toBe(0);
  });

  it('gives a bigger jump a bigger strength', () => {
    const small = new OnsetDetector();
    const big = new OnsetDetector();
    settle(small, -40, 1000);
    settle(big, -40, 1000);
    expect(big.sample(db(-20), 1000)).toBeGreaterThan(small.sample(db(-34), 1000));
  });

  it('does not fire on a loud sample after a long stall', () => {
    const d = new OnsetDetector();
    settle(d, -40, 1000);
    expect(d.sample(db(-10), 5000)).toBe(0);
  });

  it('strikes once when steady playback follows digital silence', () => {
    const d = new OnsetDetector();
    let fired = 0;
    for (let t = 0; t < 1000; t += 50) d.sample(0, t);
    for (let t = 1000; t < 2000; t += 50) fired += d.sample(db(-20), t) > 0 ? 1 : 0;
    expect(fired).toBe(1);
  });

  it('does not fire on a fast fade-in', () => {
    const d = new OnsetDetector();
    let fired = 0;
    for (let k = 0; k <= 40; k++) fired += d.sample(db(-50 + k), k * 50) > 0 ? 1 : 0;
    expect(fired).toBe(0);
  });
});
