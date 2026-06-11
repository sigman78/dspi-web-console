// Single clamp choke point for DSP write values. Clamps (never rejects),
// matching the ValueField UX. The authoritative host-side write ranges;
// UI panels keep affordances only.

import * as Eq from './eqLimits';
import * as Mix from './mixerLimits';
import * as Proc from './processingLimits';
import { utf8Truncate } from '@/utils';

export function toRange(v: number, min: number, max: number): number {
  // NaN and -Infinity -> min; +Infinity -> max
  if (!Number.isFinite(v)) return v > 0 ? max : min;
  if (v < min) return min;
  if (v > max) return max;
  return v;
}

// UI exposes [-60, 0]. The internal mute path writes MUTE_DB (-128) and must
// NOT be clamped; only the user-input setMasterVolume(db) path calls this.
export const MASTER_VOLUME_MIN_DB = -60;
export const MASTER_VOLUME_MAX_DB = 0;
export const masterVolumeDb = (db: number) =>
  toRange(db, MASTER_VOLUME_MIN_DB, MASTER_VOLUME_MAX_DB);

// Mute sentinel (per spec): the dB written to silence the master volume. Not a
// clamp bound -- deliberately below MASTER_VOLUME_MIN_DB and never clamped.
export const MUTE_DB = -128;

export const bandFrequencyHz = (hz: number) => toRange(hz, Eq.FREQ_MIN_HZ, Eq.FREQ_MAX_HZ);
export const bandQ = (q: number) => toRange(q, Eq.Q_MIN, Eq.Q_MAX);
export const bandGainDb = (db: number) => toRange(db, Eq.BAND_GAIN_MIN_DB, Eq.BAND_GAIN_MAX_DB);
export const preampDb = (db: number) => toRange(db, Eq.PREAMP_MIN_DB, Eq.PREAMP_MAX_DB);

export const outputGainDb = (db: number) => toRange(db, Mix.OUTPUT_GAIN_MIN_DB, Mix.OUTPUT_GAIN_MAX_DB);
export const outputDelayMs = (ms: number) => toRange(ms, Mix.OUTPUT_DELAY_MIN_MS, Mix.OUTPUT_DELAY_MAX_MS);
export const crosspointGainDb = (db: number) => toRange(db, Mix.CROSSPOINT_GAIN_MIN_DB, Mix.CROSSPOINT_GAIN_MAX_DB);

export const loudnessRefSpl = (db: number) => toRange(db, Proc.LOUDNESS_REF_SPL_MIN_DB, Proc.LOUDNESS_REF_SPL_MAX_DB);
export const loudnessIntensityPct = (p: number) => toRange(p, Proc.LOUDNESS_INTENSITY_MIN_PCT, Proc.LOUDNESS_INTENSITY_MAX_PCT);
export const crossfeedFreqHz = (hz: number) => toRange(hz, Proc.CROSSFEED_FREQ_MIN_HZ, Proc.CROSSFEED_FREQ_MAX_HZ);
export const crossfeedFeedDb = (db: number) => toRange(db, Proc.CROSSFEED_FEED_MIN_DB, Proc.CROSSFEED_FEED_MAX_DB);
export const levellerAmountPct = (p: number) => toRange(p, Proc.LEVELLER_AMOUNT_MIN_PCT, Proc.LEVELLER_AMOUNT_MAX_PCT);
export const levellerMaxGainDb = (db: number) => toRange(db, Proc.LEVELLER_MAX_GAIN_MIN_DB, Proc.LEVELLER_MAX_GAIN_MAX_DB);
export const levellerGateDb = (db: number) => toRange(db, Proc.LEVELLER_GATE_MIN_DB, Proc.LEVELLER_GATE_MAX_DB);

// User volume axis (firmware clamps [-60, 0] dB). Same range as master volume
// for the UI, but a separate DSP axis -- never touches MUTE_DB.
export const USER_VOLUME_MIN_DB = -60;
export const USER_VOLUME_MAX_DB = 0;
export const userVolumeDb = (db: number) => toRange(db, USER_VOLUME_MIN_DB, USER_VOLUME_MAX_DB);

// Names are encoded into a fixed NUL-terminated wire buffer. Delegates to the
// wire-layer truncator so host and wire agree on the byte budget.
export function nameToByteBudget(name: string, maxBytes: number): string {
  return utf8Truncate(name, maxBytes);
}
