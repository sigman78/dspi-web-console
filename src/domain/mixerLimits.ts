// Mixer matrix output and crosspoint ranges. Single source of truth for
// the output gain/delay sliders in EQ.04 (OutputTrim) and the matrix
// header (MatrixHeader), and for crosspoint cells (MatrixCell). Parallel
// to eqLimits.ts.

// Output channel trim. OUTPUT_DELAY_MAX_MS is the UI-imposed cap;
// firmware itself only clamps Math.max(0, v)
export const OUTPUT_GAIN_MIN_DB = -60;
export const OUTPUT_GAIN_MAX_DB = 12;
export const OUTPUT_GAIN_STEP_DB = 0.1;

export const OUTPUT_DELAY_MIN_MS = 0;
export const OUTPUT_DELAY_MAX_MS = 170;
export const OUTPUT_DELAY_STEP_MS = 0.1;

// Per-cell crosspoint gain.
export const CROSSPOINT_GAIN_MIN_DB = -60;
export const CROSSPOINT_GAIN_MAX_DB = 12;
