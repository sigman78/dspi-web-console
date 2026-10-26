import { FilterType, defaultFilter, type FilterParams } from '@/domain';
import * as Clamp from '@/domain/clamp';
import { snapQFromWheel } from '@/components/bode/eqGraphMath';

const NO_GAIN_TYPES: ReadonlySet<FilterType> = new Set([
  FilterType.LowPass,
  FilterType.HighPass,
  FilterType.Notch,
  FilterType.Allpass,
  FilterType.Allpass1,
  FilterType.LowPass1,
  FilterType.HighPass1,
  FilterType.LinkwitzTransform,
]);

const NO_Q_TYPES: ReadonlySet<FilterType> = new Set([
  FilterType.Allpass1,
  FilterType.LowShelf1,
  FilterType.HighShelf1,
  FilterType.LowPass1,
  FilterType.HighPass1,
  FilterType.LinkwitzTransform,
]);

export const bandHasGain = (type: FilterType): boolean => !NO_GAIN_TYPES.has(type);

const round = (v: number, step: number): number => Math.round(v / step) * step;

/** Where a gesture started: the band's gain and the height its node was drawn at. */
export interface DragAnchor {
  gain: number;
  db: number;
}

/**
 * Apply a pointer position to a band: f rounded to whole Hz, gain moved by the
 * pointer's travel from the anchor (the node sits on the combined curve, not at
 * the band's own gain). Gain-less types keep their gain; Linkwitz Transform is
 * returned unchanged.
 */
export function applyBandDrag(band: FilterParams, f: number, db: number, anchor: DragAnchor): FilterParams {
  if (band.type === FilterType.LinkwitzTransform) return band;
  const next: FilterParams = { ...band, frequency: Clamp.bandFrequencyHz(Math.round(f)) };
  if (bandHasGain(band.type)) next.gain = Clamp.bandGainDb(Math.round((anchor.gain + db - anchor.db) * 10) / 10);
  return next;
}

export function applyXoverDrag(band: FilterParams, f: number): FilterParams {
  if (band.type === FilterType.LinkwitzTransform) return band;
  return { ...band, frequency: Clamp.bandFrequencyHz(Math.round(f)) };
}

/** Wheel over a node: Q follows the wheel; types without Q are returned unchanged. */
export function applyWheelQ(band: FilterParams, deltaY: number): FilterParams {
  if (!bandHasQ(band.type)) return band;
  return { ...band, q: Clamp.bandQ(round(snapQFromWheel(band.q, deltaY), 0.01)) };
}

export function firstFlatIndex(bands: readonly FilterParams[]): number {
  return bands.findIndex((b) => b.type === FilterType.Flat);
}

/** Plan for adding a Peaking band of the given gain in the first free slot; null when all bands are in use. */
export function planAddBand(
  bands: readonly FilterParams[],
  f: number,
  gain: number,
): { index: number; band: FilterParams } | null {
  const index = firstFlatIndex(bands);
  if (index < 0) return null;
  return {
    index,
    band: {
      ...defaultFilter(),
      type: FilterType.Peaking,
      frequency: Clamp.bandFrequencyHz(Math.round(f)),
      gain: Clamp.bandGainDb(Math.round(gain * 10) / 10),
      q: 1,
    },
  };
}

/** Trailing debounce: `call` restarts the wait, `cancel` drops a pending run. */
export function trailingDebounce<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    call(...args: A): void {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        fn(...args);
      }, ms);
    },
    cancel(): void {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
}

export const bandHasQ = (type: FilterType): boolean => !NO_Q_TYPES.has(type);
