// Validation rules for DSP write actions. Pure functions over args (and
// optionally the current snapshot for context-sensitive rules). Returned
// failures short-circuit a mutation before any wire write.

import * as Eq from './eqLimits';
import * as Mix from './mixerLimits';
import { CrossfeedPreset, LevellerSpeed } from './processing';
import { PRESET_NAME_MAX_LEN, CHANNEL_NAME_MAX_LEN } from './presetLimits';
import { utf8ByteLength } from '../utils';

export type ValidationResult = { ok: true } | { ok: false; reason: string };

export const ok: ValidationResult = { ok: true };
export const fail = (reason: string): ValidationResult => ({ ok: false, reason });

// Master volume in dB. The hardware accepts a wider range, but the UI exposes [-60, 0]
export const MASTER_VOLUME_MIN_DB = -60;
export const MASTER_VOLUME_MAX_DB = 0;

export function validateMasterVolumeDb(db: number): ValidationResult {
  if (!Number.isFinite(db)) return fail('master volume must be finite');
  if (db < MASTER_VOLUME_MIN_DB) return fail(`master volume below ${MASTER_VOLUME_MIN_DB} dB`);
  if (db > MASTER_VOLUME_MAX_DB) return fail(`master volume above ${MASTER_VOLUME_MAX_DB} dB`);
  return ok;
}

function rangeCheck(name: string, v: number, min: number, max: number): ValidationResult {
  if (!Number.isFinite(v)) return fail(`${name} must be finite`);
  if (v < min) return fail(`${name} below ${min}`);
  if (v > max) return fail(`${name} above ${max}`);
  return ok;
}

export function validateBandFrequency(hz: number): ValidationResult {
  return rangeCheck('frequency', hz, Eq.EQ_FREQ_MIN_HZ, Eq.EQ_FREQ_MAX_HZ);
}
export function validateBandQ(q: number): ValidationResult {
  return rangeCheck('Q', q, Eq.EQ_Q_MIN, Eq.EQ_Q_MAX);
}
export function validateBandGain(db: number): ValidationResult {
  return rangeCheck('band gain', db, Eq.EQ_BAND_GAIN_MIN_DB, Eq.EQ_BAND_GAIN_MAX_DB);
}
export function validateInputPreampDb(db: number): ValidationResult {
  return rangeCheck('input preamp', db, Eq.EQ_PREAMP_MIN_DB, Eq.EQ_PREAMP_MAX_DB);
}
export function validateOutputGainDb(db: number): ValidationResult {
  return rangeCheck('output gain', db, Mix.OUTPUT_GAIN_MIN_DB, Mix.OUTPUT_GAIN_MAX_DB);
}
export function validateOutputDelayMs(ms: number): ValidationResult {
  return rangeCheck('output delay', ms, Mix.OUTPUT_DELAY_MIN_MS, Mix.OUTPUT_DELAY_MAX_MS);
}
export function validateCrosspointGainDb(db: number): ValidationResult {
  return rangeCheck('crosspoint gain', db, Mix.CROSSPOINT_GAIN_MIN_DB, Mix.CROSSPOINT_GAIN_MAX_DB);
}

// Processing module ranges. Booleans (enable, ITD, lookahead) are typed
// at the call site; only numeric/enum params need a validator here.

// Loudness -- ref SPL is the SPL the source was mastered at; ISO 226
// contours are tabulated 40-90 dB but firmware accepts a slightly wider
// range. Source: project docs.
const LOUDNESS_REF_SPL_MIN = 40;
const LOUDNESS_REF_SPL_MAX = 100;
const LOUDNESS_INTENSITY_MIN = 0;
const LOUDNESS_INTENSITY_MAX = 200;

export function validateLoudnessRefSpl(db: number): ValidationResult {
  return rangeCheck('loudness ref SPL', db, LOUDNESS_REF_SPL_MIN, LOUDNESS_REF_SPL_MAX);
}
export function validateLoudnessIntensityPct(p: number): ValidationResult {
  return rangeCheck('loudness intensity', p, LOUDNESS_INTENSITY_MIN, LOUDNESS_INTENSITY_MAX);
}

// Crossfeed -- presets 0/1/2 are firmware-fixed; preset 3 is "Custom"
// and uses the host's freq/feedDb fields. Custom range from the .NET
// reference's CrossfeedData.cs.
const CROSSFEED_FREQ_MIN_HZ = 500;
const CROSSFEED_FREQ_MAX_HZ = 2000;
const CROSSFEED_FEED_MIN_DB = 0;
const CROSSFEED_FEED_MAX_DB = 15;

export function validateCrossfeedPreset(n: number): ValidationResult {
  if (!Number.isInteger(n)) return fail('crossfeed preset must be integer');
  return rangeCheck('crossfeed preset', n, CrossfeedPreset.Preset1, CrossfeedPreset.Custom);
}
export function validateCrossfeedFreq(hz: number): ValidationResult {
  return rangeCheck('crossfeed cutoff', hz, CROSSFEED_FREQ_MIN_HZ, CROSSFEED_FREQ_MAX_HZ);
}
export function validateCrossfeedFeedDb(db: number): ValidationResult {
  return rangeCheck('crossfeed feed', db, CROSSFEED_FEED_MIN_DB, CROSSFEED_FEED_MAX_DB);
}

// Leveller -- ranges from docs/bulk_params.h section 12 (WireLevellerConfig).
const LEVELLER_AMOUNT_MIN = 0;
const LEVELLER_AMOUNT_MAX = 100;
const LEVELLER_MAX_GAIN_MIN = 0;
const LEVELLER_MAX_GAIN_MAX = 35;
const LEVELLER_GATE_MIN_DB = -96;
const LEVELLER_GATE_MAX_DB = 0;

export function validateLevellerSpeed(n: number): ValidationResult {
  if (!Number.isInteger(n)) return fail('leveller speed must be integer');
  return rangeCheck('leveller speed', n, LevellerSpeed.Slow, LevellerSpeed.Fast);
}
export function validateLevellerAmount(p: number): ValidationResult {
  return rangeCheck('leveller amount', p, LEVELLER_AMOUNT_MIN, LEVELLER_AMOUNT_MAX);
}
export function validateLevellerMaxGainDb(db: number): ValidationResult {
  return rangeCheck('leveller max gain', db, LEVELLER_MAX_GAIN_MIN, LEVELLER_MAX_GAIN_MAX);
}
export function validateLevellerGateDb(db: number): ValidationResult {
  return rangeCheck('leveller gate', db, LEVELLER_GATE_MIN_DB, LEVELLER_GATE_MAX_DB);
}

// Preset / channel name UTF-8 byte budgets. Names are encoded into a
// 32-byte NUL-terminated buffer at the wire layer; the budget is
// payload-only (31 bytes), with the NUL reserved.

export function validatePresetName(name: string): ValidationResult {
  const n = utf8ByteLength(name);
  if (n > PRESET_NAME_MAX_LEN) {
    return fail(`preset name too long: ${n} bytes > ${PRESET_NAME_MAX_LEN}`);
  }
  return ok;
}

export function validateChannelName(name: string): ValidationResult {
  const n = utf8ByteLength(name);
  if (n > CHANNEL_NAME_MAX_LEN) {
    return fail(`channel name too long: ${n} bytes > ${CHANNEL_NAME_MAX_LEN}`);
  }
  return ok;
}
