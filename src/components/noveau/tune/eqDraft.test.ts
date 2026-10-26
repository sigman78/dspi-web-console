import { describe, test, expect, vi } from 'vitest';
import { FilterType, defaultFilter, type FilterParams } from '@/domain';
import { applyBandDrag, applyWheelQ, applyXoverDrag, planAddBand, trailingDebounce } from './eqDraft';

const peak = (over: Partial<FilterParams> = {}): FilterParams => ({
  ...defaultFilter(), type: FilterType.Peaking, frequency: 1000, gain: 3, q: 1, ...over,
});

describe('applyBandDrag', () => {
  // Node on the curve at the band's own gain: pointer db maps 1:1.
  const flat = (gain: number) => ({ gain, db: gain });

  test('rounds frequency to Hz and gain to 0.1 dB', () => {
    const b = applyBandDrag(peak(), 1234.6, 2.46, flat(3));
    expect(b.frequency).toBe(1235);
    expect(b.gain).toBe(2.5);
  });

  test('clamps to the band ranges', () => {
    const b = applyBandDrag(peak(), 99999, -80, flat(3));
    expect(b.frequency).toBe(20000);
    expect(b.gain).toBe(-24);
  });

  test('a shelf node drawn at gain/2 moves the gain by the pointer travel, not to the pointer height', () => {
    const shelf = peak({ type: FilterType.LowShelf, gain: 6 });
    const b = applyBandDrag(shelf, 1000, 3.1, { gain: 6, db: 3 });
    expect(b.gain).toBe(6.1);
  });

  test('a node lifted by other curve contributions keeps its gain offset', () => {
    // Preamp -6 dB: peak gain 3 is drawn at -3.
    const b = applyBandDrag(peak(), 1000, -2, { gain: 3, db: -3 });
    expect(b.gain).toBe(4);
  });

  test.each([FilterType.LowPass, FilterType.HighPass, FilterType.Notch, FilterType.Allpass, FilterType.HighPass1])(
    'type %i keeps its gain while frequency follows',
    (type) => {
      const b = applyBandDrag(peak({ type, gain: 0 }), 500, 9, flat(0));
      expect(b.gain).toBe(0);
      expect(b.frequency).toBe(500);
    },
  );

  test('Linkwitz Transform is display-only', () => {
    const lt = peak({ type: FilterType.LinkwitzTransform, frequency: 50, gain: 30 });
    expect(applyBandDrag(lt, 500, 9, flat(30))).toBe(lt);
    expect(applyXoverDrag(lt, 500)).toBe(lt);
  });
});

describe('applyWheelQ', () => {
  test('wheel up raises Q, wheel down lowers it', () => {
    expect(applyWheelQ(peak({ q: 1 }), -100).q).toBeGreaterThan(1);
    expect(applyWheelQ(peak({ q: 1 }), 100).q).toBeLessThan(1);
  });

  test('stays within the Q range', () => {
    expect(applyWheelQ(peak({ q: 24 }), -1000).q).toBe(24);
    expect(applyWheelQ(peak({ q: 0.1 }), 1000).q).toBe(0.1);
  });

  test.each([FilterType.LowShelf1, FilterType.LinkwitzTransform])('type %i has no Q to change', (type) => {
    const b = peak({ type });
    expect(applyWheelQ(b, -100)).toBe(b);
  });
});

describe('planAddBand', () => {
  test('uses the first Flat band', () => {
    const bands = [peak(), defaultFilter(), peak(), defaultFilter()];
    const plan = planAddBand(bands, 2000, 4);
    expect(plan?.index).toBe(1);
    expect(plan?.band).toMatchObject({ type: FilterType.Peaking, frequency: 2000, gain: 4, q: 1 });
  });

  test('returns null when every band is in use', () => {
    expect(planAddBand([peak(), peak()], 2000, 4)).toBeNull();
  });
});

describe('trailingDebounce', () => {
  test('a burst commits once with the last arguments', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = trailingDebounce(fn, 150);
    d.call(1);
    vi.advanceTimersByTime(100);
    d.call(2);
    vi.advanceTimersByTime(100);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(2);
    vi.useRealTimers();
  });

  test('cancel drops the pending run', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = trailingDebounce(fn, 150);
    d.call(1);
    d.cancel();
    vi.advanceTimersByTime(500);
    expect(fn).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
