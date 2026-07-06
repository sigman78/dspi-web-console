// AutoEQ headphone-profile mapping: DB filter-type strings <-> FilterType, and
// FilterParams[] <-> AutoEqFilter[] band conversion.

import { FilterType, type FilterParams, defaultFilter, isCrossoverType } from './filter';

export interface AutoEqFilter {
  type: string;
  freq: number;
  q: number;
  gain: number;
}

export interface AutoEqEntry {
  id: string;
  manufacturer: string;
  model: string;
  source: string;
  formFactor: string;
  preamp: number;
  filters: AutoEqFilter[];
}

export interface AutoEqDatabase {
  version: number;
  generatedAt: string;
  entryCount: number;
  entries: AutoEqEntry[];
}

export function autoEqDisplayName(e: Pick<AutoEqEntry, 'manufacturer' | 'model'>): string {
  return e.model ? `${e.manufacturer} ${e.model}` : e.manufacturer;
}

export const AUTOEQ_SOURCE_LABELS: Record<string, string> = {
  'oratory1990': 'oratory1990',
  'crinacle': 'Crinacle',
  'rtings': 'Rtings',
  'innerfidelity': 'InnerFidelity',
  'headphone.com': 'Headphone.com',
};

export function autoEqSourceLabel(source: string): string {
  return AUTOEQ_SOURCE_LABELS[source] ?? source;
}

const DB_TYPE_TO_FILTER_TYPE: Record<string, FilterType> = {
  peaking: FilterType.Peaking,
  lowShelf: FilterType.LowShelf,
  highShelf: FilterType.HighShelf,
  lowPass: FilterType.LowPass,
  highPass: FilterType.HighPass,
  notch: FilterType.Notch,
  allpass: FilterType.Allpass,
  allpass1: FilterType.Allpass1,
  lowShelf1: FilterType.LowShelf1,
  highShelf1: FilterType.HighShelf1,
};

const FILTER_TYPE_TO_DB_TYPE: Partial<Record<FilterType, string>> = {
  [FilterType.Peaking]: 'peaking',
  [FilterType.LowShelf]: 'lowShelf',
  [FilterType.HighShelf]: 'highShelf',
  [FilterType.LowPass]: 'lowPass',
  [FilterType.HighPass]: 'highPass',
  [FilterType.Notch]: 'notch',
  [FilterType.Allpass]: 'allpass',
  [FilterType.Allpass1]: 'allpass1',
  [FilterType.LowShelf1]: 'lowShelf1',
  [FilterType.HighShelf1]: 'highShelf1',
};

const AUTOEQ_BAND_COUNT = 10;

export function autoEqFiltersToBands(filters: AutoEqFilter[]): FilterParams[] {
  const mapped: FilterParams[] = [];
  for (const f of filters) {
    const type = DB_TYPE_TO_FILTER_TYPE[f.type];
    if (type === undefined) continue;
    mapped.push({ type, bypass: false, frequency: f.freq, q: f.q, gain: f.gain });
    if (mapped.length >= AUTOEQ_BAND_COUNT) break;
  }
  while (mapped.length < AUTOEQ_BAND_COUNT) mapped.push(defaultFilter());
  return mapped;
}

// Mirror values are float32 round-trips (0.7 -> 0.699999988...); saved entries
// round back to sane precision so they store and display cleanly.
export function roundAutoEqValue(v: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
}

export function bandsToAutoEqFilters(bands: FilterParams[]): AutoEqFilter[] {
  const out: AutoEqFilter[] = [];
  for (const b of bands) {
    if (b.type === FilterType.Flat) continue;
    if (isCrossoverType(b.type)) continue;
    const type = FILTER_TYPE_TO_DB_TYPE[b.type];
    if (type === undefined) continue;
    out.push({
      type,
      freq: roundAutoEqValue(b.frequency, 2),
      q: roundAutoEqValue(b.q, 3),
      gain: roundAutoEqValue(b.gain, 2),
    });
  }
  return out;
}
