import { describe, it, expect } from 'vitest';
import { TYPE_ORDER, FIRST_ORDER_TYPES, LT_TYPES, offeredTypes, isLtCapable } from './BandTypeSelect.svelte';
import { FilterType } from '@/domain';

const OFF = { firstOrderEq: false, linkwitzTransform: false };

describe('offeredTypes', () => {
  it('offers only the base PEQ types when neither feature is on', () => {
    expect(offeredTypes(OFF)).toEqual(TYPE_ORDER);
  });

  it('appends the first-order types when firstOrderEq is on', () => {
    const types = offeredTypes({ ...OFF, firstOrderEq: true });
    expect(types).toEqual([...TYPE_ORDER, ...FIRST_ORDER_TYPES]);
  });

  it('appends Linkwitz Transform only when linkwitzTransform is on', () => {
    expect(offeredTypes({ ...OFF, linkwitzTransform: false })).not.toContain(FilterType.LinkwitzTransform);
    const types = offeredTypes({ ...OFF, linkwitzTransform: true });
    expect(types).toEqual([...TYPE_ORDER, ...LT_TYPES]);
  });

  it('offers both extensions together', () => {
    const types = offeredTypes({ firstOrderEq: true, linkwitzTransform: true });
    expect(types).toEqual([...TYPE_ORDER, ...FIRST_ORDER_TYPES, ...LT_TYPES]);
  });
});

describe('isLtCapable', () => {
  it('is false for the base type list and for undefined', () => {
    expect(isLtCapable(TYPE_ORDER)).toBe(false);
    expect(isLtCapable(undefined)).toBe(false);
  });

  it('is true once Linkwitz Transform is in the offered list', () => {
    expect(isLtCapable(offeredTypes({ firstOrderEq: false, linkwitzTransform: true }))).toBe(true);
  });
});
