// Single clamp choke point for DSP write values. Clamps (never rejects),
// matching the existing ValueField UX. This is the one authoritative
// host-side source of write ranges; UI panels keep affordances only.
//
// These ranges are the authoritative host-side write bounds. A future change
// should re-source them from the device adapter's per-platform limits so host
// and firmware share one source of truth (board review A2).

import * as Eq from './eqLimits';
import * as Mix from './mixerLimits';
import { utf8Truncate } from '@/utils';

export function clampToRange(v: number, min: number, max: number): number {
  // NaN and -Infinity -> min; +Infinity -> max
  if (!Number.isFinite(v)) return v > 0 ? max : min;
  if (v < min) return min;
  if (v > max) return max;
  return v;
}

// Master volume: UI exposes [-60, 0]. NOTE: the internal mute path writes
// MUTE_DB (-128) and must NOT be clamped; only the public setMasterVolume(db)
// user-input path calls this.
export const MASTER_VOLUME_MIN_DB = -60;
export const MASTER_VOLUME_MAX_DB = 0;
export const clampMasterVolumeDb = (db: number) =>
  clampToRange(db, MASTER_VOLUME_MIN_DB, MASTER_VOLUME_MAX_DB);

export const clampBandFrequencyHz = (hz: number) => clampToRange(hz, Eq.FREQ_MIN_HZ, Eq.FREQ_MAX_HZ);
export const clampBandQ = (q: number) => clampToRange(q, Eq.Q_MIN, Eq.Q_MAX);
export const clampBandGainDb = (db: number) => clampToRange(db, Eq.BAND_GAIN_MIN_DB, Eq.BAND_GAIN_MAX_DB);
export const clampPreampDb = (db: number) => clampToRange(db, Eq.PREAMP_MIN_DB, Eq.PREAMP_MAX_DB);

export const clampOutputGainDb = (db: number) => clampToRange(db, Mix.OUTPUT_GAIN_MIN_DB, Mix.OUTPUT_GAIN_MAX_DB);
export const clampOutputDelayMs = (ms: number) => clampToRange(ms, Mix.OUTPUT_DELAY_MIN_MS, Mix.OUTPUT_DELAY_MAX_MS);
export const clampCrosspointGainDb = (db: number) => clampToRange(db, Mix.CROSSPOINT_GAIN_MIN_DB, Mix.CROSSPOINT_GAIN_MAX_DB);

// Processing module ranges. See the header note on re-sourcing from the adapter.
export const clampLoudnessRefSpl = (db: number) => clampToRange(db, 40, 100);
export const clampLoudnessIntensityPct = (p: number) => clampToRange(p, 0, 200);
export const clampCrossfeedFreqHz = (hz: number) => clampToRange(hz, 500, 2000);
export const clampCrossfeedFeedDb = (db: number) => clampToRange(db, 0, 15);
export const clampLevellerAmountPct = (p: number) => clampToRange(p, 0, 100);
export const clampLevellerMaxGainDb = (db: number) => clampToRange(db, 0, 35);
export const clampLevellerGateDb = (db: number) => clampToRange(db, -96, 0);

// Names are encoded into a fixed NUL-terminated wire buffer. Delegates to the
// wire-layer truncator so host and wire agree on the byte budget.
export function clampNameToByteBudget(name: string, maxBytes: number): string {
  return utf8Truncate(name, maxBytes);
}
