import { describe, it, expect } from 'vitest';
import {
  FilterType, QP_DEFAULT, seedTypeChange, offeredTypes, TYPE_ORDER, FIRST_ORDER_TYPES, FIRST_ORDER_LP_HP_TYPES,
  type FilterParams,
} from './filter';

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

describe('offeredTypes', () => {
  it('offers only the base PEQ types when firstOrderEq is off', () => {
    expect(offeredTypes({ firstOrderEq: false })).toEqual(TYPE_ORDER);
  });

  it('appends the first-order types when firstOrderEq is on', () => {
    expect(offeredTypes({ firstOrderEq: true })).toEqual([...TYPE_ORDER, ...FIRST_ORDER_TYPES]);
  });

  it('never offers Linkwitz Transform, even with every feature on', () => {
    expect(offeredTypes({ firstOrderEq: true, firstOrderLpHp: true })).not.toContain(FilterType.LinkwitzTransform);
  });

  it('withholds the first-order low/high pass types until firstOrderLpHp is on', () => {
    expect(offeredTypes({ firstOrderEq: true })).not.toEqual(expect.arrayContaining(FIRST_ORDER_LP_HP_TYPES));
    expect(offeredTypes({ firstOrderEq: true, firstOrderLpHp: false })).not.toEqual(expect.arrayContaining(FIRST_ORDER_LP_HP_TYPES));
  });

  it('appends the first-order low/high pass types when firstOrderLpHp is on, independent of firstOrderEq', () => {
    expect(offeredTypes({ firstOrderEq: true, firstOrderLpHp: true }))
      .toEqual([...TYPE_ORDER, ...FIRST_ORDER_TYPES, ...FIRST_ORDER_LP_HP_TYPES]);
    // A device could in principle report firstOrderLpHp without firstOrderEq
    // (they're independent capability gates) -- the LP/HP types still show up.
    expect(offeredTypes({ firstOrderEq: false, firstOrderLpHp: true }))
      .toEqual([...TYPE_ORDER, ...FIRST_ORDER_LP_HP_TYPES]);
  });
});
