// EQ filter taxonomy and per-band parameters. FilterType numeric values are
// firmware-pinned; the enum is a domain concept used across the EQ stack.
//
// The value space is partitioned (fw config.h contract, wire V16+):
//   0..7    second-order PEQ types (all firmware)
//   8..10   first-order PEQ types (V16+)
//   11      Linkwitz Transform (V22+)
//   12..31  reserved for future PEQ types
//   32..63  crossover types, contiguous from XoverFirst (V16+)

export const FilterType = {
  Flat: 0,
  Peaking: 1,
  LowShelf: 2,
  HighShelf: 3,
  LowPass: 4,
  HighPass: 5,
  Notch: 6,
  Allpass: 7,

  // First-order sections (V16+). Allpass1: freq only (Q/gain unused).
  // Shelf1: freq + gain, gentle 6 dB/oct (Q unused).
  Allpass1: 8,
  LowShelf1: 9,
  HighShelf1: 10,

  // Linkwitz Transform (V22+). freq/q hold the driver's resonant f0/Q0; the
  // gain slot is reinterpreted to carry the target fp in Hz (not dB); the
  // target Qp travels in the separate FilterParams.qp sidecar.
  LinkwitzTransform: 11,

  // Crossover types (V16+): (family, order, LP/HP) per value.
  Lr2Lp: 32,  Lr2Hp: 33,
  Lr4Lp: 34,  Lr4Hp: 35,
  Lr6Lp: 36,  Lr6Hp: 37,
  Lr8Lp: 38,  Lr8Hp: 39,
  Bw1Lp: 40,  Bw1Hp: 41,
  Bw2Lp: 42,  Bw2Hp: 43,
  Bw3Lp: 44,  Bw3Hp: 45,
  Bw4Lp: 46,  Bw4Hp: 47,
  Bw5Lp: 48,  Bw5Hp: 49,
  Bw6Lp: 50,  Bw6Hp: 51,
  Bw7Lp: 52,  Bw7Hp: 53,
  Bw8Lp: 54,  Bw8Hp: 55,
  Bes2Lp: 56, Bes2Hp: 57,
  Bes4Lp: 58, Bes4Hp: 59,
  Bes6Lp: 60, Bes6Hp: 61,
  Bes8Lp: 62, Bes8Hp: 63,
} as const;
export type FilterType = (typeof FilterType)[keyof typeof FilterType];

export const XOVER_TYPE_FIRST = FilterType.Lr2Lp;
export const XOVER_TYPE_LAST = FilterType.Bes8Hp;

// Wire band-index window for crossover bands (fw XOVER_BAND_BASE /
// MAX_XOVER_BANDS): vendor EQ commands address crossover bands at
// band indices 20..23; 0..bandCount-1 stay PEQ.
export const XOVER_BAND_BASE = 20;
export const MAX_XOVER_BANDS = 4;

export function isCrossoverType(t: number): boolean {
  return t >= XOVER_TYPE_FIRST && t <= XOVER_TYPE_LAST;
}

export function isPeqType(t: number): boolean {
  return t >= 0 && t < XOVER_TYPE_FIRST;
}

// First-order sections require the firstOrderEq capability (wire V16+).
export function isFirstOrderType(t: FilterType): boolean {
  return t === FilterType.Allpass1 || t === FilterType.LowShelf1 || t === FilterType.HighShelf1;
}

// Parameter usage per type: crossover and first-order all-pass carry no gain;
// crossover, first-order sections, and all-passes carry no Q.
export function filterUsesQ(t: FilterType): boolean {
  if (isCrossoverType(t)) return false;
  return !isFirstOrderType(t);
}

export function filterUsesGain(t: FilterType): boolean {
  if (isCrossoverType(t)) return false;
  return t !== FilterType.Allpass && t !== FilterType.Allpass1
      && t !== FilterType.Notch
      && t !== FilterType.LowPass && t !== FilterType.HighPass;
}

export interface FilterParams {
  type: FilterType;
  bypass: boolean;
  frequency: number; // Hz
  q: number;
  gain: number;     // dB (Linkwitz Transform: fp in Hz -- see FilterType.LinkwitzTransform)
  // Linkwitz Transform target Qp (V22+ only; absent for every other type).
  qp?: number;
}

export const defaultFilter = (): FilterParams => ({
  type: FilterType.Flat,
  bypass: false,
  frequency: 1000,
  q: 1,
  gain: 0,
});

// Linkwitz Transform qp wire encoding: u16 = round(Qp*512); 0 means the
// firmware default 0.707 rather than a literal zero Qp.
export const QP_WIRE_SCALE = 512;
export const QP_DEFAULT = 0.707;

export function decodeQp(raw: number): number {
  return raw === 0 ? QP_DEFAULT : raw / QP_WIRE_SCALE;
}

export function encodeQp(qp: number): number {
  return Math.round(qp * QP_WIRE_SCALE);
}

// Seed sensible field values on a band-type switch. Every ordinary type
// transition keeps freq/q/gain untouched (an unused field is simply ignored
// downstream), but Linkwitz Transform reinterprets the gain slot as fp (Hz)
// and carries qp separately, so switching into or out of it needs explicit
// handling to avoid leaking a stale gain-as-Hz or fp-as-dB value.
export function seedTypeChange(prev: FilterParams, nextType: FilterType): Partial<FilterParams> {
  if (nextType === prev.type) return {};
  if (nextType === FilterType.LinkwitzTransform) {
    // f0/Q0 come from prev.frequency/prev.q as-is; start fp == f0 (flat) at
    // the default Qp.
    return { gain: prev.frequency, qp: QP_DEFAULT };
  }
  if (prev.type === FilterType.LinkwitzTransform) {
    return { gain: 0, qp: undefined };
  }
  return {};
}
