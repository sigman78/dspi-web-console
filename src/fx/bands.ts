export const BAND_COUNT = 31;
/** ISO third-octave centres, 20 Hz to 20 kHz. */
export const BAND_HZ: readonly number[] = Array.from({ length: BAND_COUNT }, (_, i) => 10 ** ((i + 13) / 10));

/** Sparse frequency labels as [band index, text]. */
export const BAND_TICKS: ReadonlyArray<readonly [number, string]> = [
  [2, '31'], [5, '63'], [8, '125'], [11, '250'], [14, '500'],
  [17, '1k'], [20, '2k'], [23, '4k'], [26, '8k'], [29, '16k'],
];
