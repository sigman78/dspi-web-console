import { describe, it, expect } from 'vitest';
import { filterCurve } from './filterCurve';
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
