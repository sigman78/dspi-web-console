// Tolerance-banded structural diff between two DspSnapshot instances.
// Tolerances mirror PresetSnapshot.cs:144 (PresetDiff.Diff) — they mask
// float round-trip jitter from wire serialization. Without them, every
// fetch would flip dirty true on the first re-read.
//
// `ignoreMasterVolume` is set by callers in Mode 0 (volume lives in the
// directory, not the preset payload). `softMuted` ignores volume while
// the UI's soft-mute is engaged so the -128 sentinel doesn't mark dirty.

import type { DspSnapshot, ChannelModel } from './snapshot';
import type { OutputModel, RouteModel } from './mixer';
import type { FilterParams } from './filter';

export const PRESET_DIFF_TOLERANCE = {
  db:   0.05,
  freq: 0.5,
  gain: 0.005,
  ms:   0.00005,
} as const;

export interface DiffOptions {
  ignoreMasterVolume: boolean;
  softMuted:          boolean;
}

function neq(a: number, b: number, tol: number): boolean {
  return Math.abs(a - b) > tol;
}

function bandDiffers(a: FilterParams, b: FilterParams): boolean {
  if (a.type !== b.type) return true;
  if (neq(a.frequency, b.frequency, PRESET_DIFF_TOLERANCE.freq)) return true;
  // Q is dimensionless; the `gain` tolerance band (0.005) is the right
  // magnitude for masking wire-round-trip jitter even though it's not a
  // linear-gain value semantically.
  if (neq(a.q,         b.q,         PRESET_DIFF_TOLERANCE.gain)) return true;
  if (neq(a.gain,      b.gain,      PRESET_DIFF_TOLERANCE.db))   return true;
  return false;
}

function channelDiffers(a: ChannelModel, b: ChannelModel): boolean {
  if (a.name !== b.name) return true;
  // Band count is platform-defined; assume equal between baseline and live.
  for (let i = 0; i < a.filters.length; i++) {
    if (bandDiffers(a.filters[i], b.filters[i])) return true;
  }
  return false;
}

function outputDiffers(a: OutputModel, b: OutputModel): boolean {
  if (a.enabled !== b.enabled) return true;
  if (a.muted   !== b.muted)   return true;
  if (neq(a.gainDb,  b.gainDb,  PRESET_DIFF_TOLERANCE.db)) return true;
  if (neq(a.delayMs, b.delayMs, PRESET_DIFF_TOLERANCE.ms)) return true;
  return false;
}

function routeDiffers(a: RouteModel, b: RouteModel): boolean {
  if (a.enabled !== b.enabled) return true;
  if (a.invert  !== b.invert)  return true;
  if (neq(a.gainDb, b.gainDb, PRESET_DIFF_TOLERANCE.gain)) return true;
  return false;
}

export function presetDiff(
  baseline: DspSnapshot,
  live:     DspSnapshot,
  opts:     DiffOptions,
): boolean {
  if (baseline.bypass !== live.bypass) return true;
  if (neq(baseline.masterPreampDb,   live.masterPreampDb,   PRESET_DIFF_TOLERANCE.db)) return true;
  if (neq(baseline.inputPreampDb[0], live.inputPreampDb[0], PRESET_DIFF_TOLERANCE.db)) return true;
  if (neq(baseline.inputPreampDb[1], live.inputPreampDb[1], PRESET_DIFF_TOLERANCE.db)) return true;

  const skipVolume = opts.ignoreMasterVolume || opts.softMuted;
  if (!skipVolume && neq(baseline.masterVolumeDb, live.masterVolumeDb, PRESET_DIFF_TOLERANCE.db)) {
    return true;
  }

  // Loudness
  const l1 = baseline.loudness, l2 = live.loudness;
  if (l1.enabled !== l2.enabled) return true;
  if (neq(l1.refSpl,       l2.refSpl,       PRESET_DIFF_TOLERANCE.db))   return true;
  if (neq(l1.intensityPct, l2.intensityPct, PRESET_DIFF_TOLERANCE.gain)) return true;

  // Crossfeed
  const c1 = baseline.crossfeed, c2 = live.crossfeed;
  if (c1.enabled !== c2.enabled) return true;
  if (c1.preset  !== c2.preset)  return true;
  if (c1.itd     !== c2.itd)     return true;
  if (neq(c1.freq,   c2.freq,   PRESET_DIFF_TOLERANCE.freq)) return true;
  if (neq(c1.feedDb, c2.feedDb, PRESET_DIFF_TOLERANCE.db))   return true;

  // Leveller (optional — V7+)
  if ((baseline.leveller == null) !== (live.leveller == null)) return true;
  if (baseline.leveller && live.leveller) {
    const a = baseline.leveller, b = live.leveller;
    if (a.enabled   !== b.enabled)   return true;
    if (a.speed     !== b.speed)     return true;
    if (a.lookahead !== b.lookahead) return true;
    if (neq(a.amount,    b.amount,    PRESET_DIFF_TOLERANCE.gain)) return true;
    if (neq(a.maxGainDb, b.maxGainDb, PRESET_DIFF_TOLERANCE.db))   return true;
    if (neq(a.gateDb,    b.gateDb,    PRESET_DIFF_TOLERANCE.db))   return true;
  }

  // Channels and outputs are platform-fixed in count for a given device,
  // so no length-mismatch guard here. Routes are variable (length tested
  // separately below).
  // Channels (name + EQ bands)
  for (let i = 0; i < baseline.channels.length; i++) {
    if (channelDiffers(baseline.channels[i], live.channels[i])) return true;
  }

  // Outputs
  for (let i = 0; i < baseline.outputs.length; i++) {
    if (outputDiffers(baseline.outputs[i], live.outputs[i])) return true;
  }

  // Routes (mixer)
  if (baseline.routes.length !== live.routes.length) return true;
  for (let i = 0; i < baseline.routes.length; i++) {
    if (routeDiffers(baseline.routes[i], live.routes[i])) return true;
  }

  return false;
}
