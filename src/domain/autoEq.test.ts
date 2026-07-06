import { describe, it, expect } from 'vitest';
import {
  autoEqFiltersToBands, bandsToAutoEqFilters, autoEqDisplayName,
  type AutoEqFilter,
} from './autoEq';
import { FilterType, defaultFilter, type FilterParams } from './filter';

describe('autoEqFiltersToBands', () => {
  it('maps known filter types onto FilterParams with matching frequency/q/gain', () => {
    const filters: AutoEqFilter[] = [
      { type: 'lowShelf', freq: 105, q: 0.7, gain: 5.5 },
      { type: 'peaking', freq: 1000, q: 1.2, gain: -3 },
      { type: 'highShelf', freq: 8000, q: 0.7, gain: -1.1 },
      { type: 'notch', freq: 60, q: 4, gain: 0 },
      { type: 'allpass1', freq: 200, q: 1, gain: 0 },
    ];
    const bands = autoEqFiltersToBands(filters);
    expect(bands[0]).toMatchObject({ type: FilterType.LowShelf, frequency: 105, q: 0.7, gain: 5.5, bypass: false });
    expect(bands[1]).toMatchObject({ type: FilterType.Peaking, frequency: 1000, q: 1.2, gain: -3 });
    expect(bands[2]).toMatchObject({ type: FilterType.HighShelf, frequency: 8000, q: 0.7, gain: -1.1 });
    expect(bands[3]).toMatchObject({ type: FilterType.Notch, frequency: 60, q: 4, gain: 0 });
    expect(bands[4]).toMatchObject({ type: FilterType.Allpass1, frequency: 200 });
  });

  it('skips filters with an unrecognized type string instead of throwing', () => {
    const filters: AutoEqFilter[] = [
      { type: 'peaking', freq: 100, q: 1, gain: 2 },
      { type: 'bogusType', freq: 500, q: 1, gain: 4 },
      { type: 'peaking', freq: 2000, q: 1, gain: -2 },
    ];
    const bands = autoEqFiltersToBands(filters);
    // Only the two recognized filters are mapped; the bogus one leaves no trace.
    expect(bands[0].frequency).toBe(100);
    expect(bands[1].frequency).toBe(2000);
    expect(bands.some((b) => b.frequency === 500)).toBe(false);
  });

  it('truncates more than 10 filters to exactly 10 bands, keeping the first 10', () => {
    const filters: AutoEqFilter[] = Array.from({ length: 14 }, (_, i) => (
      { type: 'peaking', freq: 100 + i * 100, q: 1, gain: i }
    ));
    const bands = autoEqFiltersToBands(filters);
    expect(bands).toHaveLength(10);
    expect(bands[9].frequency).toBe(100 + 9 * 100);
  });

  it('pads fewer than 10 filters with default (Flat) bands', () => {
    const filters: AutoEqFilter[] = [
      { type: 'peaking', freq: 500, q: 1, gain: 3 },
    ];
    const bands = autoEqFiltersToBands(filters);
    expect(bands).toHaveLength(10);
    expect(bands[0].type).toBe(FilterType.Peaking);
    for (let i = 1; i < 10; i++) {
      expect(bands[i]).toEqual(defaultFilter());
    }
  });
});

describe('bandsToAutoEqFilters', () => {
  it('drops Flat bands', () => {
    const bands: FilterParams[] = [
      { type: FilterType.Peaking, bypass: false, frequency: 1000, q: 1, gain: 3 },
      defaultFilter(),
      { type: FilterType.LowShelf, bypass: false, frequency: 100, q: 0.7, gain: 4 },
    ];
    const filters = bandsToAutoEqFilters(bands);
    expect(filters).toHaveLength(2);
    expect(filters.some((f) => f.type === 'peaking')).toBe(true);
    expect(filters.some((f) => f.type === 'lowShelf')).toBe(true);
  });

  it('drops crossover-type bands', () => {
    const bands: FilterParams[] = [
      { type: FilterType.Peaking, bypass: false, frequency: 1000, q: 1, gain: 3 },
      { type: FilterType.Lr4Lp, bypass: false, frequency: 80, q: 0.7, gain: 0 },
      { type: FilterType.Bes8Hp, bypass: false, frequency: 12000, q: 0.7, gain: 0 },
    ];
    const filters = bandsToAutoEqFilters(bands);
    expect(filters).toHaveLength(1);
    expect(filters[0].type).toBe('peaking');
  });

  it('does not encode the bypass flag', () => {
    const bands: FilterParams[] = [
      { type: FilterType.Peaking, bypass: true, frequency: 1000, q: 1, gain: 3 },
    ];
    const filters = bandsToAutoEqFilters(bands);
    expect(filters[0]).toEqual({ type: 'peaking', freq: 1000, q: 1, gain: 3 });
  });

  it('rounds float32 mirror noise back to clean values', () => {
    const bands: FilterParams[] = [
      {
        type: FilterType.LowShelf,
        bypass: false,
        frequency: Math.fround(105.1),
        q: Math.fround(0.7),
        gain: Math.fround(5.5),
      },
    ];
    expect(bandsToAutoEqFilters(bands)[0]).toEqual({ type: 'lowShelf', freq: 105.1, q: 0.7, gain: 5.5 });
  });
});

describe('round trip: bands -> filters -> bands', () => {
  it('preserves meaningful non-default bands through both conversions', () => {
    const original: FilterParams[] = [
      { type: FilterType.LowShelf, bypass: false, frequency: 105, q: 0.7, gain: 5.5 },
      { type: FilterType.Peaking, bypass: false, frequency: 3842, q: 3.05, gain: 6.4 },
      { type: FilterType.HighShelf, bypass: false, frequency: 10000, q: 0.7, gain: -1.1 },
      defaultFilter(),
      defaultFilter(),
      defaultFilter(),
      defaultFilter(),
      defaultFilter(),
      defaultFilter(),
      defaultFilter(),
    ];
    const filters = bandsToAutoEqFilters(original);
    const roundTripped = autoEqFiltersToBands(filters);
    expect(roundTripped[0]).toMatchObject({ type: FilterType.LowShelf, frequency: 105, q: 0.7, gain: 5.5 });
    expect(roundTripped[1]).toMatchObject({ type: FilterType.Peaking, frequency: 3842, q: 3.05, gain: 6.4 });
    expect(roundTripped[2]).toMatchObject({ type: FilterType.HighShelf, frequency: 10000, q: 0.7, gain: -1.1 });
    for (let i = 3; i < 10; i++) {
      expect(roundTripped[i]).toEqual(defaultFilter());
    }
  });
});

describe('autoEqDisplayName', () => {
  it('joins manufacturer and model when both are present', () => {
    expect(autoEqDisplayName({ manufacturer: 'Sony', model: 'WH-1000XM4' })).toBe('Sony WH-1000XM4');
  });

  it('falls back to manufacturer alone when model is empty', () => {
    expect(autoEqDisplayName({ manufacturer: 'My Custom Profile', model: '' })).toBe('My Custom Profile');
  });
});
