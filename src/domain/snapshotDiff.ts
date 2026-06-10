// Typed structural change-set between two DspSnapshot instances. Single-pass
// walker emits one SnapshotChange per changed area, carrying the NEW value
// (from `b`). Consumers: presetsDirty and notification apply. Tolerances mask
// wire float round-trip jitter.

import type { DspSnapshot } from './snapshot';
import type { I2sConfig } from './platform';
import type { OutputModel, RouteModel } from './mixer';
import type { FilterParams } from './filter';
import type { Loudness, Crossfeed, Leveller } from './processing';
import type { InputConfig, LgSoundSync, UserVolume, DacHwMute } from './deviceSections';
import { BAND_GAIN_STEP_DB, FREQ_STEP_HZ, Q_STEP } from './eqLimits';

// Half the relevant UI step: wire f32 round-trip jitter can never reach it,
// a real edit always does.
export const DIFF_TOLERANCE = {
  db:   BAND_GAIN_STEP_DB / 2, // 0.1 / 2 = 0.05
  freq: FREQ_STEP_HZ / 2,      // 1 / 2 = 0.5
  // No gain-field step halves to 0.005; crosspoint has no UI step,
  // loudness intensity step is 0.5, leveller amount step is 1. Using literal.
  gain: 0.005,
  q:    Q_STEP / 2,             // 0.01 / 2 = 0.005
  // NOT step/2: f32 round-trip jitter bound. Delay diffs must not mask
  // sub-step external changes; f32 ulp at max delay is ~1.5e-5 < this.
  ms:   5e-5,
} as const;

export type SnapshotChange =
  | { kind: 'bypass';        value: boolean }
  | { kind: 'masterPreamp';  value: number }
  | { kind: 'inputPreamp';   channel: 0 | 1; value: number }
  | { kind: 'masterVolume';  value: number }
  // channelIndex: array position into channels[] (NOT a ChannelId; e.g. PDM is
  // position 6 on RP2040 but has ChannelId 10).
  | { kind: 'channelName';   channelIndex: number; value: string }
  | { kind: 'band';          channelIndex: number; band: number; value: FilterParams }
  | { kind: 'output';        index: number; value: OutputModel }
  | { kind: 'route';         index: number; value: RouteModel }
  | { kind: 'loudness';      value: Loudness }
  | { kind: 'crossfeed';     value: Crossfeed }
  | { kind: 'leveller';      value: Leveller }
  | { kind: 'inputConfig';   value: InputConfig | null }
  | { kind: 'userVolume';    value: UserVolume | null }
  | { kind: 'dacHwMute';     value: DacHwMute | null }
  | { kind: 'lgSoundSyncEnabled'; value: boolean }
  | { kind: 'lgSoundSyncStatus';  value: { present: boolean; volume: number; muted: boolean } }
  | { kind: 'i2s';           value: I2sConfig }
  | { kind: 'outputPins';    value: number[] };

function neq(a: number, b: number, tol: number): boolean {
  return Math.abs(a - b) > tol;
}

// Changed iff exactly one side is absent (null/undefined), else by `differs`.
// Tolerates undefined as equivalent to null so partial fixtures don't crash.
function nullableChanged<T>(a: T | null | undefined, b: T | null | undefined, differs: (x: T, y: T) => boolean): boolean {
  const an = a == null, bn = b == null;
  if (an || bn) return an !== bn;
  return differs(a as T, b as T);
}

function bandDiffers(a: FilterParams, b: FilterParams): boolean {
  return a.type !== b.type
      || a.bypass !== b.bypass
      || neq(a.frequency, b.frequency, DIFF_TOLERANCE.freq)
      || neq(a.q,         b.q,         DIFF_TOLERANCE.q)
      || neq(a.gain,      b.gain,      DIFF_TOLERANCE.db);
}

function outputDiffers(a: OutputModel, b: OutputModel): boolean {
  return a.enabled !== b.enabled
      || a.muted   !== b.muted
      || neq(a.gainDb,  b.gainDb,  DIFF_TOLERANCE.db)
      || neq(a.delayMs, b.delayMs, DIFF_TOLERANCE.ms);
}

function routeDiffers(a: RouteModel, b: RouteModel): boolean {
  return a.enabled !== b.enabled
      || a.invert  !== b.invert
      || neq(a.gainDb, b.gainDb, DIFF_TOLERANCE.gain);
}

function loudnessDiffers(a: Loudness, b: Loudness): boolean {
  return a.enabled !== b.enabled
      || neq(a.refSpl,       b.refSpl,       DIFF_TOLERANCE.db)
      || neq(a.intensityPct, b.intensityPct, DIFF_TOLERANCE.gain);
}

function crossfeedDiffers(a: Crossfeed, b: Crossfeed): boolean {
  return a.enabled !== b.enabled
      || a.preset  !== b.preset
      || a.itd     !== b.itd
      || neq(a.freq,   b.freq,   DIFF_TOLERANCE.freq)
      || neq(a.feedDb, b.feedDb, DIFF_TOLERANCE.db);
}

function levellerDiffers(a: Leveller, b: Leveller): boolean {
  return a.enabled   !== b.enabled
      || a.speed     !== b.speed
      || a.lookahead !== b.lookahead
      || neq(a.amount,    b.amount,    DIFF_TOLERANCE.gain)
      || neq(a.maxGainDb, b.maxGainDb, DIFF_TOLERANCE.db)
      || neq(a.gateDb,    b.gateDb,    DIFF_TOLERANCE.db);
}

function inputConfigDiffers(a: InputConfig, b: InputConfig): boolean {
  return a.source !== b.source || a.spdifRxPin !== b.spdifRxPin;
}

function userVolumeDiffers(a: UserVolume, b: UserVolume): boolean {
  return a.mute !== b.mute || neq(a.volumeDb, b.volumeDb, DIFF_TOLERANCE.db);
}

function dacHwMuteDiffers(a: DacHwMute, b: DacHwMute): boolean {
  return a.enabled   !== b.enabled
      || a.activeLow !== b.activeLow
      || a.pin       !== b.pin
      || a.holdMs    !== b.holdMs
      || a.releaseMs !== b.releaseMs;
}

function i2sDiffers(a: I2sConfig, b: I2sConfig): boolean {
  return a.bckPin !== b.bckPin
      || a.mckPin !== b.mckPin
      || a.mckEnabled !== b.mckEnabled
      || a.mckMultiplierEncoded !== b.mckMultiplierEncoded
      || a.outputSlotTypes.some((v, i) => v !== b.outputSlotTypes[i]);
}

function pinsDiffer(a: number[], b: number[]): boolean {
  return a.length !== b.length || a.some((v, i) => v !== b[i]);
}

// lgSoundSync splits into a host-settable `enabled` kind and a device-reported
// status kind. Nullness mismatch (unreachable same-session) emits both.
function diffLgSoundSync(a: LgSoundSync | null, b: LgSoundSync | null, out: SnapshotChange[]): void {
  const an = a == null, bn = b == null;
  if (an || bn) {
    if (an === bn) return;           // both absent -> no change
    if (b != null) {
      out.push({ kind: 'lgSoundSyncEnabled', value: b.enabled });
      out.push({ kind: 'lgSoundSyncStatus', value: { present: b.present, volume: b.volume, muted: b.muted } });
    }
    return;
  }
  if (a.enabled !== b.enabled) out.push({ kind: 'lgSoundSyncEnabled', value: b.enabled });
  if (a.present !== b.present || a.volume !== b.volume || a.muted !== b.muted) {
    out.push({ kind: 'lgSoundSyncStatus', value: { present: b.present, volume: b.volume, muted: b.muted } });
  }
}

export function diffSnapshots(a: DspSnapshot, b: DspSnapshot): SnapshotChange[] {
  const out: SnapshotChange[] = [];

  if (a.bypass !== b.bypass) out.push({ kind: 'bypass', value: b.bypass });
  if (neq(a.masterPreampDb, b.masterPreampDb, DIFF_TOLERANCE.db)) out.push({ kind: 'masterPreamp', value: b.masterPreampDb });
  if (neq(a.inputPreampDb[0], b.inputPreampDb[0], DIFF_TOLERANCE.db)) out.push({ kind: 'inputPreamp', channel: 0, value: b.inputPreampDb[0] });
  if (neq(a.inputPreampDb[1], b.inputPreampDb[1], DIFF_TOLERANCE.db)) out.push({ kind: 'inputPreamp', channel: 1, value: b.inputPreampDb[1] });
  if (neq(a.masterVolumeDb, b.masterVolumeDb, DIFF_TOLERANCE.db)) out.push({ kind: 'masterVolume', value: b.masterVolumeDb });

  if (loudnessDiffers(a.loudness, b.loudness)) out.push({ kind: 'loudness', value: b.loudness });
  if (crossfeedDiffers(a.crossfeed, b.crossfeed)) out.push({ kind: 'crossfeed', value: b.crossfeed });
  if (levellerDiffers(a.leveller, b.leveller)) out.push({ kind: 'leveller', value: b.leveller });

  for (let i = 0; i < b.channels.length; i++) {
    const ca = a.channels[i], cb = b.channels[i];
    if (ca === undefined) continue;
    if (ca.name !== cb.name) out.push({ kind: 'channelName', channelIndex: i, value: cb.name });
    for (let j = 0; j < cb.filters.length; j++) {
      if (bandDiffers(ca.filters[j], cb.filters[j])) out.push({ kind: 'band', channelIndex: i, band: j, value: cb.filters[j] });
    }
  }

  for (let i = 0; i < b.outputs.length; i++) {
    const oa = a.outputs[i];
    if (oa === undefined) continue;
    if (outputDiffers(oa, b.outputs[i])) out.push({ kind: 'output', index: i, value: b.outputs[i] });
  }

  // Fixed input x output grid; iterate the live side. A route in `b` but
  // absent in `a` counts as a change.
  for (let i = 0; i < b.routes.length; i++) {
    const ra = a.routes[i];
    if (ra === undefined || routeDiffers(ra, b.routes[i])) out.push({ kind: 'route', index: i, value: b.routes[i] });
  }

  if (nullableChanged(a.inputConfig, b.inputConfig, inputConfigDiffers)) out.push({ kind: 'inputConfig', value: b.inputConfig });
  if (nullableChanged(a.userVolume,  b.userVolume,  userVolumeDiffers))  out.push({ kind: 'userVolume',  value: b.userVolume });
  if (nullableChanged(a.dacHwMute,   b.dacHwMute,   dacHwMuteDiffers))   out.push({ kind: 'dacHwMute',   value: b.dacHwMute });
  diffLgSoundSync(a.lgSoundSync, b.lgSoundSync, out);

  if (i2sDiffers(a.i2s, b.i2s)) out.push({ kind: 'i2s', value: b.i2s });
  if (pinsDiffer(a.outputPins, b.outputPins)) out.push({ kind: 'outputPins', value: b.outputPins });

  return out;
}

// Every top-level DspSnapshot key must be either covered by a change kind or
// explicitly exempted here. Adding a field without deciding its diff story is
// a compile error.
type _Exempt  = 'platform';
type _Covered =
  | 'bypass'
  | 'masterPreampDb'
  | 'inputPreampDb'
  | 'masterVolumeDb'
  | 'channels'
  | 'outputs'
  | 'routes'
  | 'loudness'
  | 'crossfeed'
  | 'leveller'
  | 'inputConfig'
  | 'userVolume'
  | 'dacHwMute'
  | 'lgSoundSync'
  | 'i2s'
  | 'outputPins';
type _Complete = [Exclude<keyof DspSnapshot, _Covered | _Exempt>] extends [never] ? true : never;
const _complete: _Complete = true;
void _complete;
type _NoStale = [Exclude<_Covered | _Exempt, keyof DspSnapshot>] extends [never] ? true : never;
const _noStale: _NoStale = true;
void _noStale;
