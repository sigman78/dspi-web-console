// EQ parameter ranges and editor step sizes (band freq/Q/gain, global
// preamp, Bode plot span). Re-exported as the `Eq` namespace from `../domain`.

// Audio band -- also the Bode plot's horizontal extent.
export const FREQ_MIN_HZ = 20;
export const FREQ_MAX_HZ = 20000;
export const FREQ_STEP_HZ = 1;

// Filter Q (resonance / bandwidth control).
export const Q_MIN = 0.1;
export const Q_MAX = 24;
export const Q_STEP = 0.01;

// Per-band gain (peaking / shelf).
export const BAND_GAIN_MIN_DB = -24;
export const BAND_GAIN_MAX_DB = 24;
export const BAND_GAIN_STEP_DB = 0.1;

// Global EQ preamp.
export const PREAMP_MIN_DB = -60;
export const PREAMP_MAX_DB = 10;
export const PREAMP_STEP_DB = 0.1;
export const PREAMP_TICKS_DB: readonly number[] = [-60, -40, -20, 0, 10];

// Default vertical (dB) range the Bode plot uses for EQ curves.
export const BODE_DB_RANGE: readonly [number, number] = [-25, 25];
