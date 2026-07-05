// Crossover / first-order curve math, checked against the analytic filter
// invariants (not against the implementation's own tables): Butterworth is
// -3.01 dB at fc for every order, Linkwitz-Riley is -6.02 dB at fc,
// magnitude-normalized Bessel is -3.01 dB at fc, and LP+HP LR pairs of the
// same fc sum to unity magnitude (allpass).

import { describe, it, expect } from 'vitest';
import { FilterType, defaultFilter, type FilterParams } from '@/domain';
import { filterCurveAt, EQ_SAMPLE_RATE } from './filterCurve';
import { xoverSectionCoeffs } from './xoverCurve';

const FC = 1000;

function xoverBand(type: FilterType, frequency = FC): FilterParams {
  return { ...defaultFilter(), type, frequency };
}

function dbAt(type: FilterType, f: number): number {
  return filterCurveAt([], 0, f, [xoverBand(type)]);
}

describe('xover curve — analytic invariants at fc', () => {
  it('Butterworth is -3.01 dB at fc for orders 1..8', () => {
    const bwTypes = [
      FilterType.Bw1Lp, FilterType.Bw2Lp, FilterType.Bw3Lp, FilterType.Bw4Lp,
      FilterType.Bw5Lp, FilterType.Bw6Lp, FilterType.Bw7Lp, FilterType.Bw8Lp,
      FilterType.Bw3Hp, FilterType.Bw8Hp,
    ];
    for (const t of bwTypes) {
      expect(dbAt(t, FC), `type ${t}`).toBeCloseTo(-3.0103, 2);
    }
  });

  it('Linkwitz-Riley is -6.02 dB at fc for orders 2..8', () => {
    for (const t of [FilterType.Lr2Lp, FilterType.Lr4Lp, FilterType.Lr6Lp, FilterType.Lr8Lp, FilterType.Lr4Hp, FilterType.Lr6Hp]) {
      expect(dbAt(t, FC), `type ${t}`).toBeCloseTo(-6.0206, 2);
    }
  });

  it('magnitude-normalized Bessel is -3.01 dB at fc', () => {
    for (const t of [FilterType.Bes2Lp, FilterType.Bes4Lp, FilterType.Bes6Lp, FilterType.Bes8Lp, FilterType.Bes4Hp]) {
      expect(dbAt(t, FC), `type ${t}`).toBeCloseTo(-3.0103, 1);
    }
  });

  it('rolls off at the family slope (BW4 LP: ~-24 dB/oct in the stopband)', () => {
    // Bilinear warping steepens the digital roll-off approaching Nyquist,
    // so the octave above 4*fc reads slightly hot vs the analog 24 dB.
    const oneOctave = dbAt(FilterType.Bw4Lp, FC * 4) - dbAt(FilterType.Bw4Lp, FC * 8);
    expect(oneOctave).toBeGreaterThan(22);
    expect(oneOctave).toBeLessThan(29);
  });

  it('an LR4 LP/HP pair at the same fc sums to unity magnitude', () => {
    // LR pairs are allpass in-phase: |LP| + |HP| = 1 at every frequency.
    for (const f of [200, FC, 5000]) {
      const lp = Math.pow(10, dbAt(FilterType.Lr4Lp, f) / 20);
      const hp = Math.pow(10, dbAt(FilterType.Lr4Hp, f) / 20);
      expect(lp + hp).toBeCloseTo(1, 3);
    }
  });

  it('bypassed and Flat crossover bands contribute nothing', () => {
    expect(filterCurveAt([], 0, FC, [{ ...xoverBand(FilterType.Lr4Lp), bypass: true }])).toBe(0);
    expect(xoverSectionCoeffs(FilterType.Flat, FC, EQ_SAMPLE_RATE)).toEqual([]);
  });
});

describe('first-order EQ types in the curve', () => {
  it('LowShelf1 lifts DC by its gain and is flat at high frequency', () => {
    const band: FilterParams = { ...defaultFilter(), type: FilterType.LowShelf1, frequency: FC, gain: 6 };
    expect(filterCurveAt([band], 0, 20)).toBeCloseTo(6, 1);
    expect(filterCurveAt([band], 0, 20000)).toBeCloseTo(0, 0);
  });

  it('HighShelf1 is the mirror: unity at DC, gain toward Nyquist', () => {
    const band: FilterParams = { ...defaultFilter(), type: FilterType.HighShelf1, frequency: FC, gain: -6 };
    expect(filterCurveAt([band], 0, 20)).toBeCloseTo(0, 1);
    expect(filterCurveAt([band], 0, 16000)).toBeCloseTo(-6, 0);
  });

  it('Allpass1 is magnitude-flat', () => {
    const band: FilterParams = { ...defaultFilter(), type: FilterType.Allpass1, frequency: FC };
    for (const f of [100, FC, 10000]) expect(filterCurveAt([band], 0, f)).toBe(0);
  });
});
