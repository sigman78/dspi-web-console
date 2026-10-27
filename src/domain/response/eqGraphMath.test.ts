import { describe, test, expect } from 'vitest';
import { Eq } from '@/domain';
import * as EqGraphMath from './eqGraphMath';
import type { PlotGeometry } from './eqGraphMath';

const g: PlotGeometry = { padL: 30, plotW: 600, plotH: 200, yMin: -25, yMax: 25 };

describe('coordinate mapping', () => {
  test('x <-> f round-trips', () => {
    for (const f of [20, 63, 1000, 8200, 20000]) {
      expect(EqGraphMath.fForX(EqGraphMath.xForF(f, g), g)).toBeCloseTo(f, 6);
    }
  });

  test('y <-> db round-trips', () => {
    for (const db of [-25, -3.3, 0, 12, 25]) {
      expect(EqGraphMath.dbForY(EqGraphMath.yForDb(db, g), g)).toBeCloseTo(db, 6);
    }
  });

  test('pointer outside the plot clamps to the limits', () => {
    expect(EqGraphMath.fForX(-100, g)).toBeCloseTo(Eq.FREQ_MIN_HZ, 6);
    expect(EqGraphMath.fForX(5000, g)).toBeCloseTo(Eq.FREQ_MAX_HZ, 6);
    expect(EqGraphMath.dbForY(-50, g)).toBe(25);
    expect(EqGraphMath.dbForY(999, g)).toBe(-25);
  });
});

describe('snapQFromWheel', () => {
  test('wheel up raises Q, wheel down lowers it', () => {
    expect(EqGraphMath.snapQFromWheel(1, -100)).toBeGreaterThan(1);
    expect(EqGraphMath.snapQFromWheel(1, 100)).toBeLessThan(1);
  });

  test('clamps to Q limits and rounds to 2 decimals', () => {
    expect(EqGraphMath.snapQFromWheel(Eq.Q_MAX, -1000)).toBe(Eq.Q_MAX);
    expect(EqGraphMath.snapQFromWheel(Eq.Q_MIN, 1000)).toBe(Eq.Q_MIN);
    expect(EqGraphMath.snapQFromWheel(0.707, -100)).toBe(0.78);
  });
});

describe('dragToParams', () => {
  test('maps the pointer to f and db', () => {
    const p = EqGraphMath.dragToParams({ f: 100, db: 0 }, EqGraphMath.xForF(1000, g), EqGraphMath.yForDb(6, g), g);
    expect(p.f).toBeCloseTo(1000, 6);
    expect(p.db).toBeCloseTo(6, 6);
  });

  test('lockDb keeps db and still moves f', () => {
    const p = EqGraphMath.dragToParams({ f: 100, db: 3, lockDb: true }, EqGraphMath.xForF(500, g), EqGraphMath.yForDb(-10, g), g);
    expect(p.db).toBe(3);
    expect(p.f).toBeCloseTo(500, 6);
  });

  test('clamps beyond the plot', () => {
    const p = EqGraphMath.dragToParams({ f: 100, db: 0 }, 10000, -500, g);
    expect(p).toEqual({ f: Eq.FREQ_MAX_HZ, db: Eq.BAND_GAIN_MAX_DB });
  });
});

describe('nudgeParams', () => {
  test('arrows move f by 2 % and db by 0.1 / 1', () => {
    expect(EqGraphMath.nudgeParams({ f: 1000, db: 0 }, 'ArrowRight', false, g)!.f).toBeCloseTo(1020, 6);
    expect(EqGraphMath.nudgeParams({ f: 1000, db: 0 }, 'ArrowUp', false, g)!.db).toBe(0.1);
    expect(EqGraphMath.nudgeParams({ f: 1000, db: 0 }, 'ArrowDown', true, g)!.db).toBe(-1);
  });

  test('lockDb ignores vertical keys; limits clamp; other keys ignored', () => {
    expect(EqGraphMath.nudgeParams({ f: 1000, db: 0, lockDb: true }, 'ArrowUp', false, g)).toBeNull();
    expect(EqGraphMath.nudgeParams({ f: 20000, db: 25 }, 'ArrowRight', false, g)!.f).toBe(Eq.FREQ_MAX_HZ);
    expect(EqGraphMath.nudgeParams({ f: 20000, db: 25 }, 'ArrowUp', true, g)!.db).toBe(Eq.BAND_GAIN_MAX_DB);
    expect(EqGraphMath.nudgeParams({ f: 1000, db: 0 }, 'a', false, g)).toBeNull();
  });
});
