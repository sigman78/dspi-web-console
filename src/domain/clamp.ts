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

// Consumed as a namespace (`import * as Clamp from '@/domain/clamp'`), matching
// the Eq./Mix. limit-module convention; members are unprefixed (Clamp.masterVolumeDb).
export function toRange(v: number, min: number, max: number): number {
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
export const masterVolumeDb = (db: number) =>
  toRange(db, MASTER_VOLUME_MIN_DB, MASTER_VOLUME_MAX_DB);

export const bandFrequencyHz = (hz: number) => toRange(hz, Eq.FREQ_MIN_HZ, Eq.FREQ_MAX_HZ);
export const bandQ = (q: number) => toRange(q, Eq.Q_MIN, Eq.Q_MAX);
export const bandGainDb = (db: number) => toRange(db, Eq.BAND_GAIN_MIN_DB, Eq.BAND_GAIN_MAX_DB);
export const preampDb = (db: number) => toRange(db, Eq.PREAMP_MIN_DB, Eq.PREAMP_MAX_DB);

export const outputGainDb = (db: number) => toRange(db, Mix.OUTPUT_GAIN_MIN_DB, Mix.OUTPUT_GAIN_MAX_DB);
export const outputDelayMs = (ms: number) => toRange(ms, Mix.OUTPUT_DELAY_MIN_MS, Mix.OUTPUT_DELAY_MAX_MS);
export const crosspointGainDb = (db: number) => toRange(db, Mix.CROSSPOINT_GAIN_MIN_DB, Mix.CROSSPOINT_GAIN_MAX_DB);

// Processing module ranges. See the header note on re-sourcing from the adapter.
export const loudnessRefSpl = (db: number) => toRange(db, 40, 100);
export const loudnessIntensityPct = (p: number) => toRange(p, 0, 200);
export const crossfeedFreqHz = (hz: number) => toRange(hz, 500, 2000);
export const crossfeedFeedDb = (db: number) => toRange(db, 0, 15);
export const levellerAmountPct = (p: number) => toRange(p, 0, 100);
export const levellerMaxGainDb = (db: number) => toRange(db, 0, 35);
export const levellerGateDb = (db: number) => toRange(db, -96, 0);

// Names are encoded into a fixed NUL-terminated wire buffer. Delegates to the
// wire-layer truncator so host and wire agree on the byte budget.
export function nameToByteBudget(name: string, maxBytes: number): string {
  return utf8Truncate(name, maxBytes);
}
