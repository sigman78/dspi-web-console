import { describe, it, expect } from 'vitest';
import { filterCurve, filterCurveAt } from './filterCurve';
import { FilterType, type FilterParams } from '@/domain';

const peak = (bypass: boolean): FilterParams => ({
  type: FilterType.Peaking, bypass, frequency: 1000, q: 1, gain: 12,
});

describe('filterCurve — band bypass', () => {
  it('a bypassed band contributes nothing (equals a flat preamp line)', () => {
    const active = filterCurve([peak(false)], 0);
    const bypassed = filterCurve([peak(true)], 0);
    const flat = new Array(active.length).fill(0);
    expect(bypassed).toEqual(flat);
    expect(Math.max(...active)).toBeGreaterThan(6);
  });
});

const lt = (over: Partial<FilterParams> = {}): FilterParams => ({
  type: FilterType.LinkwitzTransform, bypass: false, frequency: 100, q: 0.7, gain: 50, qp: 0.9,
  ...over,
});

describe('filterCurve — Linkwitz Transform', () => {
  it('approximates the implied DC boost 40*log10(f0/fp) well below both corners', () => {
    // f0=100, fp=50 -> a 2x ratio, ~12.04 dB. Evaluated near f=0 so the
    // prewarped tan() terms are still essentially linear in frequency.
    const db = filterCurveAt([lt({ frequency: 100, gain: 50 })], 0, 0.01);
    expect(db).toBeCloseTo(40 * Math.log10(2), 1);
  });

  it('approaches 0 dB well above both corners (approaches unity at Nyquist)', () => {
    const db = filterCurveAt([lt({ frequency: 100, gain: 50 })], 0, 20000);
    expect(Math.abs(db)).toBeLessThan(2);
  });

  it('is exactly flat (0 dB) when fp <= 0 -- firmware treats a non-positive fp as flat', () => {
    const curve = filterCurve([lt({ gain: 0 })], 0);
    expect(curve).toEqual(new Array(curve.length).fill(0));
  });

  it('treats an absent/zero qp as the firmware default 0.707, not zero', () => {
    const withDefault = filterCurveAt([lt({ qp: 0.707 })], 0, 40);
    const withUndefined = filterCurveAt([lt({ qp: undefined })], 0, 40);
    const withZero = filterCurveAt([lt({ qp: 0 })], 0, 40);
    expect(withUndefined).toBeCloseTo(withDefault, 6);
    expect(withZero).toBeCloseTo(withDefault, 6);
  });

  it('adds the preamp on top of the LT section, same as every other type', () => {
    const withoutPreamp = filterCurveAt([lt()], 0, 0.01);
    const withPreamp = filterCurveAt([lt()], 5, 0.01);
    expect(withPreamp - withoutPreamp).toBeCloseTo(5, 6);
  });
});
