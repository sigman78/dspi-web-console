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
  it('offers only the base PEQ types when firstOrderEq is off', () => {
    expect(Filter.offeredTypes({ firstOrderEq: false })).toEqual(Filter.TYPE_ORDER);
  });

  it('appends the first-order types when firstOrderEq is on', () => {
    expect(Filter.offeredTypes({ firstOrderEq: true })).toEqual([...Filter.TYPE_ORDER, ...Filter.FIRST_ORDER_TYPES]);
  });

  it('never offers Linkwitz Transform, even with every feature on', () => {
    expect(Filter.offeredTypes({ firstOrderEq: true, firstOrderLpHp: true })).not.toContain(Filter.FilterType.LinkwitzTransform);
  });

  it('withholds the first-order low/high pass types until firstOrderLpHp is on', () => {
    expect(Filter.offeredTypes({ firstOrderEq: true })).not.toEqual(expect.arrayContaining(Filter.FIRST_ORDER_LP_HP_TYPES));
    expect(Filter.offeredTypes({ firstOrderEq: true, firstOrderLpHp: false })).not.toEqual(expect.arrayContaining(Filter.FIRST_ORDER_LP_HP_TYPES));
  });

  it('appends the first-order low/high pass types when firstOrderLpHp is on, independent of firstOrderEq', () => {
    expect(Filter.offeredTypes({ firstOrderEq: true, firstOrderLpHp: true }))
      .toEqual([...Filter.TYPE_ORDER, ...Filter.FIRST_ORDER_TYPES, ...Filter.FIRST_ORDER_LP_HP_TYPES]);
    // A device could in principle report firstOrderLpHp without firstOrderEq
    // (they're independent capability gates) -- the LP/HP types still show up.
    expect(Filter.offeredTypes({ firstOrderEq: false, firstOrderLpHp: true }))
      .toEqual([...Filter.TYPE_ORDER, ...Filter.FIRST_ORDER_LP_HP_TYPES]);
  });
});
