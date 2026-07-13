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

export const MASTER_VOLUME_MIN_DB = -60;
export const MASTER_VOLUME_MAX_DB = 0;
export const masterVolumeDb = (db: number) =>
  toRange(db, MASTER_VOLUME_MIN_DB, MASTER_VOLUME_MAX_DB);

// DAC HW mute timing bounds (firmware dac_hw_mute.h; an enabled config with
// hold_ms outside [1, 500] is silently rejected by the deferred handler).
export const DAC_HW_MUTE_HOLD_MS_MIN = 1;
export const DAC_HW_MUTE_HOLD_MS_MAX = 500;
export const DAC_HW_MUTE_RELEASE_MS_MAX = 500;
export const dacHwMuteHoldMs = (ms: number) =>
  toRange(ms, DAC_HW_MUTE_HOLD_MS_MIN, DAC_HW_MUTE_HOLD_MS_MAX);
export const dacHwMuteReleaseMs = (ms: number) =>
  toRange(ms, 0, DAC_HW_MUTE_RELEASE_MS_MAX);

export const bandFrequencyHz = (hz: number) => toRange(hz, Eq.FREQ_MIN_HZ, Eq.FREQ_MAX_HZ);
export const bandQ = (q: number) => toRange(q, Eq.Q_MIN, Eq.Q_MAX);
export const bandGainDb = (db: number) => toRange(db, Eq.BAND_GAIN_MIN_DB, Eq.BAND_GAIN_MAX_DB);
export const preampDb = (db: number) => toRange(db, Eq.PREAMP_MIN_DB, Eq.PREAMP_MAX_DB);

// Linkwitz Transform: f0/fp share one range, Q0/Qp share another (both
// narrower than the general PEQ band -- see eqLimits.ts).
export const bandLtFreqHz = (hz: number) => toRange(hz, Eq.LT_FREQ_MIN_HZ, Eq.LT_FREQ_MAX_HZ);
export const bandLtQ = (q: number) => toRange(q, Eq.LT_Q_MIN, Eq.LT_Q_MAX);

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

// Names are encoded into a fixed NUL-terminated wire buffer. Delegates to the
// wire-layer truncator so host and wire agree on the byte budget.
export function nameToByteBudget(name: string, maxBytes: number): string {
  return utf8Truncate(name, maxBytes);
}
