// EQ filter taxonomy and per-band parameters. FilterType numeric values are
// firmware-pinned; the enum is a domain concept used across the EQ stack.
//
// The value space is partitioned (fw config.h contract):
//   0..7    second-order PEQ types (all firmware)
//   8..10   first-order PEQ types
//   11      Linkwitz Transform
//   12..13  first-order low/high pass
//   14..31  reserved for future PEQ types
//   32..63  crossover types, contiguous from XoverFirst

export const FilterType = {
  Flat: 0,
  Peaking: 1,
  LowShelf: 2,
  HighShelf: 3,
  LowPass: 4,
  HighPass: 5,
  Notch: 6,
  Allpass: 7,

  // First-order sections. Allpass1: freq only (Q/gain unused).
  // Shelf1: freq + gain, gentle 6 dB/oct (Q unused).
  Allpass1: 8,
  LowShelf1: 9,
  HighShelf1: 10,

  // Linkwitz Transform. freq/q hold the driver's resonant f0/Q0; the
  // gain slot is reinterpreted to carry the target fp in Hz (not dB); the
  // target Qp travels in the separate FilterParams.qp sidecar.
  LinkwitzTransform: 11,

  // First-order low/high pass: single-pole 6 dB/oct, -3 dB at the corner, no resonance. freq
  // only -- Q and gain are unused, same treatment as Allpass1.
  LowPass1: 12,
  HighPass1: 13,

  // Crossover types: (family, order, LP/HP) per value.
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

export function isFirstOrderType(t: FilterType): boolean {
  return t === FilterType.Allpass1 || t === FilterType.LowShelf1 || t === FilterType.HighShelf1;
}

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

export const bandHasQ = (type: FilterType): boolean => !NO_Q_TYPES.has(type);

export interface FilterParams {
  type: FilterType;
  bypass: boolean;
  frequency: number; // Hz
  q: number;
  gain: number;     // dB (Linkwitz Transform: fp in Hz -- see FilterType.LinkwitzTransform)
  // Linkwitz Transform target Qp (absent for every other type).
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

// UI label per FilterType. "Off" is the user-facing name for Flat.
// Crossover labels are consumed by the crossover editor, not this select.
export const TYPE_LABELS: Record<FilterType, string> = {
  [FilterType.Flat]: 'Off',
  [FilterType.Peaking]: 'Peaking',
  [FilterType.LowShelf]: 'Low Shelf',
  [FilterType.HighShelf]: 'High Shelf',
  [FilterType.LowPass]: 'Low Pass',
  [FilterType.HighPass]: 'High Pass',
  [FilterType.Notch]: 'Notch',
  [FilterType.Allpass]: 'Allpass',
  [FilterType.Allpass1]: 'Allpass 1st',
  [FilterType.LowShelf1]: 'Low Shelf 1st',
  [FilterType.HighShelf1]: 'High Shelf 1st',
  [FilterType.LowPass1]: 'Low Pass 1st',
  [FilterType.HighPass1]: 'High Pass 1st',
  [FilterType.LinkwitzTransform]: 'Linkwitz',
  [FilterType.Lr2Lp]: 'LR2 LP',   [FilterType.Lr2Hp]: 'LR2 HP',
  [FilterType.Lr4Lp]: 'LR4 LP',   [FilterType.Lr4Hp]: 'LR4 HP',
  [FilterType.Lr6Lp]: 'LR6 LP',   [FilterType.Lr6Hp]: 'LR6 HP',
  [FilterType.Lr8Lp]: 'LR8 LP',   [FilterType.Lr8Hp]: 'LR8 HP',
  [FilterType.Bw1Lp]: 'BW1 LP',   [FilterType.Bw1Hp]: 'BW1 HP',
  [FilterType.Bw2Lp]: 'BW2 LP',   [FilterType.Bw2Hp]: 'BW2 HP',
  [FilterType.Bw3Lp]: 'BW3 LP',   [FilterType.Bw3Hp]: 'BW3 HP',
  [FilterType.Bw4Lp]: 'BW4 LP',   [FilterType.Bw4Hp]: 'BW4 HP',
  [FilterType.Bw5Lp]: 'BW5 LP',   [FilterType.Bw5Hp]: 'BW5 HP',
  [FilterType.Bw6Lp]: 'BW6 LP',   [FilterType.Bw6Hp]: 'BW6 HP',
  [FilterType.Bw7Lp]: 'BW7 LP',   [FilterType.Bw7Hp]: 'BW7 HP',
  [FilterType.Bw8Lp]: 'BW8 LP',   [FilterType.Bw8Hp]: 'BW8 HP',
  [FilterType.Bes2Lp]: 'BES2 LP', [FilterType.Bes2Hp]: 'BES2 HP',
  [FilterType.Bes4Lp]: 'BES4 LP', [FilterType.Bes4Hp]: 'BES4 HP',
  [FilterType.Bes6Lp]: 'BES6 LP', [FilterType.Bes6Hp]: 'BES6 HP',
  [FilterType.Bes8Lp]: 'BES8 LP', [FilterType.Bes8Hp]: 'BES8 HP',
};

// PEQ types this select offers. Crossover types never appear here (they
// live in the crossover editor).
export const TYPE_ORDER: FilterType[] = [
  FilterType.Flat,
  FilterType.Peaking,
  FilterType.LowShelf,
  FilterType.HighShelf,
  FilterType.HighPass,
  FilterType.LowPass,
  FilterType.Notch,
  FilterType.Allpass,
];

export const FIRST_ORDER_TYPES: FilterType[] = [
  FilterType.LowShelf1,
  FilterType.HighShelf1,
  FilterType.Allpass1,
];

// First-order low/high pass, kept apart from FIRST_ORDER_TYPES.
export const FIRST_ORDER_LP_HP_TYPES: FilterType[] = [
  FilterType.LowPass1,
  FilterType.HighPass1,
];

// Single source of truth for which PEQ types the EQ editor offers. Linkwitz
// Transform is display-only (see the component below): it's never offered
// here -- a band already set to it still renders correctly, just not
// selectable.
export function offeredTypes(): FilterType[] {
  return [...TYPE_ORDER, ...FIRST_ORDER_TYPES, ...FIRST_ORDER_LP_HP_TYPES];
}
