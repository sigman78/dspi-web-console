import { describe, it, expect } from 'vitest';
import * as Filter from './filter';
import type { FilterParams } from './filter';

const band = (over: Partial<FilterParams> = {}): FilterParams => ({
  type: Filter.FilterType.Peaking,
  bypass: false,
  frequency: 250,
  q: 1.4,
  gain: 6,
  ...over,
});

describe('seedTypeChange', () => {
  it('is a no-op when the type does not actually change', () => {
    const b = band();
    expect(Filter.seedTypeChange(b, b.type)).toEqual({});
  });

  it('switching into Linkwitz Transform seeds fp == f0 (flat) and the default Qp', () => {
    const b = band({ type: Filter.FilterType.LowShelf, frequency: 80, gain: -3 });
    expect(Filter.seedTypeChange(b, Filter.FilterType.LinkwitzTransform)).toEqual({ gain: 80, qp: Filter.QP_DEFAULT });
  });

  it('switching away from Linkwitz Transform resets the gain slot and drops qp', () => {
    const b = band({ type: Filter.FilterType.LinkwitzTransform, frequency: 60, gain: 45, qp: 1.2 });
    expect(Filter.seedTypeChange(b, Filter.FilterType.Peaking)).toEqual({ gain: 0, qp: undefined });
  });

  it('an ordinary type-to-type switch (neither side LT) seeds nothing', () => {
    const b = band({ type: Filter.FilterType.Peaking });
    expect(Filter.seedTypeChange(b, Filter.FilterType.HighPass)).toEqual({});
  });
});

describe('offeredTypes', () => {
  it('offers the base, first-order and first-order LP/HP types, never Linkwitz Transform', () => {
    const types = Filter.offeredTypes();
    expect(types).toEqual([...Filter.TYPE_ORDER, ...Filter.FIRST_ORDER_TYPES, ...Filter.FIRST_ORDER_LP_HP_TYPES]);
    expect(types).not.toContain(Filter.FilterType.LinkwitzTransform);
  });
});
