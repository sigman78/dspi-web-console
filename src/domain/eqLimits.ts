// EQ parameter ranges and editor step sizes.
// Single source of truth for the user-editable bounds of an EQ band
// (frequency / Q / gain) and the global preamp adjustment, plus the
// vertical span the Bode plot reserves when rendering an EQ response.

// Audio band -- also the Bode plot's horizontal extent.
export const EQ_FREQ_MIN_HZ = 20;
export const EQ_FREQ_MAX_HZ = 20000;
export const EQ_FREQ_STEP_HZ = 1;

// Filter Q (resonance / bandwidth control).
export const EQ_Q_MIN = 0.1;
export const EQ_Q_MAX = 24;
export const EQ_Q_STEP = 0.01;

// Per-band gain (peaking / shelf).
export const EQ_BAND_GAIN_MIN_DB = -24;
export const EQ_BAND_GAIN_MAX_DB = 24;
export const EQ_BAND_GAIN_STEP_DB = 0.1;

// Global EQ preamp.
export const EQ_PREAMP_MIN_DB = -60;
export const EQ_PREAMP_MAX_DB = 10;
export const EQ_PREAMP_STEP_DB = 0.1;
export const EQ_PREAMP_TICKS_DB: readonly number[] = [-60, -40, -20, 0, 10];

// Default vertical (dB) range the Bode plot uses for EQ curves.
export const EQ_BODE_DB_RANGE: readonly [number, number] = [-25, 25];
