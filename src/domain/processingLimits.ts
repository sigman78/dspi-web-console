// Processing-module parameter ranges (loudness / crossfeed / leveller) and
// editor step sizes. Single source of truth for the clamp choke point
// (`clamp.ts`) and the PR.01–PR.03 panels. Parallel to eqLimits.ts /
// mixerLimits.ts.
//
// Re-exported as the `Proc` namespace from `../domain` — call sites use
// `Proc.LOUDNESS_REF_SPL_MIN_DB`, etc.
//
// See the clamp.ts header on re-sourcing these from the device adapter's
// per-platform limits (board review A2).

// Loudness (PR.02).
export const LOUDNESS_REF_SPL_MIN_DB = 40;
export const LOUDNESS_REF_SPL_MAX_DB = 100;
export const LOUDNESS_REF_SPL_STEP_DB = 1;

export const LOUDNESS_INTENSITY_MIN_PCT = 0;
export const LOUDNESS_INTENSITY_MAX_PCT = 200;
export const LOUDNESS_INTENSITY_STEP_PCT = 0.5;

// Crossfeed (PR.01).
export const CROSSFEED_FREQ_MIN_HZ = 500;
export const CROSSFEED_FREQ_MAX_HZ = 2000;
export const CROSSFEED_FREQ_STEP_HZ = 10;

export const CROSSFEED_FEED_MIN_DB = 0;
export const CROSSFEED_FEED_MAX_DB = 15;
export const CROSSFEED_FEED_STEP_DB = 0.5;

// Volume Leveller (PR.03).
export const LEVELLER_AMOUNT_MIN_PCT = 0;
export const LEVELLER_AMOUNT_MAX_PCT = 100;
export const LEVELLER_AMOUNT_STEP_PCT = 1;

export const LEVELLER_MAX_GAIN_MIN_DB = 0;
export const LEVELLER_MAX_GAIN_MAX_DB = 35;
export const LEVELLER_MAX_GAIN_STEP_DB = 0.5;

export const LEVELLER_GATE_MIN_DB = -96;
export const LEVELLER_GATE_MAX_DB = 0;
export const LEVELLER_GATE_STEP_DB = 1;
