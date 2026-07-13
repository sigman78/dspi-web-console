import { describe, it, expect } from 'vitest';
import { FilterType, QP_DEFAULT, seedTypeChange, type FilterParams } from './filter';

const band = (over: Partial<FilterParams> = {}): FilterParams => ({
  type: FilterType.Peaking,
  bypass: false,
  frequency: 250,
  q: 1.4,
  gain: 6,
  ...over,
});

describe('seedTypeChange', () => {
  it('is a no-op when the type does not actually change', () => {
    const b = band();
    expect(seedTypeChange(b, b.type)).toEqual({});
  });

  it('switching into Linkwitz Transform seeds fp == f0 (flat) and the default Qp', () => {
    const b = band({ type: FilterType.LowShelf, frequency: 80, gain: -3 });
    expect(seedTypeChange(b, FilterType.LinkwitzTransform)).toEqual({ gain: 80, qp: QP_DEFAULT });
  });

  it('switching away from Linkwitz Transform resets the gain slot and drops qp', () => {
    const b = band({ type: FilterType.LinkwitzTransform, frequency: 60, gain: 45, qp: 1.2 });
    expect(seedTypeChange(b, FilterType.Peaking)).toEqual({ gain: 0, qp: undefined });
  });

  it('an ordinary type-to-type switch (neither side LT) seeds nothing', () => {
    const b = band({ type: FilterType.Peaking });
    expect(seedTypeChange(b, FilterType.HighPass)).toEqual({});
  });
});
