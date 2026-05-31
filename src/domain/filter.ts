// EQ filter taxonomy and per-band parameters.
// Numeric values of FilterType are firmware-pinned (mirrors
// DSPiConsole.Core/Models/FilterParams.cs), but the enum is a
// domain concept used everywhere from the EQ canvas to preset import.

export const FilterType = {
  Flat: 0,
  Peaking: 1,
  LowShelf: 2,
  HighShelf: 3,
  LowPass: 4,
  HighPass: 5,
  Notch: 6,
  Allpass: 7,
} as const;
export type FilterType = (typeof FilterType)[keyof typeof FilterType];

export interface FilterParams {
  type: FilterType;
  bypass: boolean;
  frequency: number; // Hz
  q: number;
  gain: number;     // dB
}

export const defaultFilter = (): FilterParams => ({
  type: FilterType.Flat,
  bypass: false,
  frequency: 1000,
  q: 1,
  gain: 0,
});
