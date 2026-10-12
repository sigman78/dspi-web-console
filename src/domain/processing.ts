// DSP processing blocks. Mirrors bulk_params.h sections 3 (crossfeed),
// 12 (leveller), and the global-params loudness fields.

export interface Loudness {
  enabled: boolean;
  refSpl: number;
  intensityPct: number;
  // Per-output mask (fw V19+): bit k selects output channel k. Default all-on
  // (0xFFFF) matches the firmware factory value and is the effective behaviour
  // on pre-V19 firmware. Firmware does no zero-to-default remap, so this must
  // never be sent as 0.
  outputMask: number;
}

// Crossfeed preset selector. Presets 0..2 are firmware-fixed curves;
// preset 3 (Custom) uses the host's freq + feedDb fields.
export const CrossfeedPreset = {
  Preset1: 0,
  Preset2: 1,
  Preset3: 2,
  Custom:  3,
} as const;
export type CrossfeedPreset = (typeof CrossfeedPreset)[keyof typeof CrossfeedPreset];

export interface Crossfeed {
  enabled: boolean;
  preset: CrossfeedPreset;
  itd: boolean;
  freq: number;
  feedDb: number;
  // Output-pair mask (fw V20+): bit p selects output pair p (outputs 2p/2p+1;
  // the mono PDM sub is not a pair and is excluded). Default 0x01 (pair 1 only)
  // matches the firmware factory value -- legacy stereo behaviour. Firmware
  // does no zero-to-default remap, so this must never be sent as 0.
  outputPairMask: number;
}

// Leveller speed. Slow/Medium/Fast pick a curve smoothing
// time-constant (firmware-fixed; speed=Slow is the safest fallback).
export const LevellerSpeed = {
  Slow:   0,
  Medium: 1,
  Fast:   2,
} as const;
export type LevellerSpeed = (typeof LevellerSpeed)[keyof typeof LevellerSpeed];

export interface Leveller {
  enabled: boolean;
  speed: LevellerSpeed;
  lookahead: boolean;
  amount: number;
  maxGainDb: number;
  gateDb: number;
  // Multichannel masks (fw V18+): bit k selects input channel k. detectorMask =
  // inputs that feed the shared RMS detector; applyMask = inputs that receive
  // the computed gain. Default all-on (0xFF) matches the firmware factory value
  // and is the effective behaviour on pre-V18 firmware (single-instance leveller).
  detectorMask: number;
  applyMask: number;
}

// Psychoacoustic bass enhancement (fw V23+, RP2350 only). outputMask mirrors
// the loudness/crossfeed per-output mask convention: bit k selects output
// channel k, default all-on (0xFFFF) matches the firmware factory value.
// Firmware does no zero-to-default remap, so this must never be sent as 0.
export interface Psybass {
  enabled: boolean;
  outputMask: number;
  cutoffHz: number;
  harmonicsDb: number;
  driveDb: number;
  characterPct: number;
  originalDb: number;
}

// Stereo upmixer center/surround modes (fw upmix.h). Documentation constants
// only -- Upmix.centerMode/surroundMode carry the raw wire value (see below).
export const UpmixCenterMode = {
  Passive:  0,
  Adaptive: 1,
  // V27+: surrounds-only upmixing, L/R bit-exact. Appended value -- older
  // firmware clamps an out-of-range centre-mode byte to Adaptive, so this
  // option must stay hidden below the upmixCenterOff capability.
  Off:      2,
} as const;
export type UpmixCenterMode = (typeof UpmixCenterMode)[keyof typeof UpmixCenterMode];

export const UpmixSurroundMode = {
  Off:      0,
  Passive:  1,
  Adaptive: 2,
} as const;
export type UpmixSurroundMode = (typeof UpmixSurroundMode)[keyof typeof UpmixSurroundMode];

// Stereo upmixer (fw V25+, RP2350 only). Wire-1:1 like Psybass -- centerMode/
// surroundMode are raw wire values (map via UpmixCenterMode/UpmixSurroundMode)
// rather than narrowed enum types. presenceDb is fw V26+; bulkParser decodes
// it from the wire's presenceQ1 int8 (dB x2), defaulting to 0 on V25 packets
// (byte was reserved).
export interface Upmix {
  enabled: boolean;
  centerMode: number;
  surroundMode: number;
  strengthPct: number;
  centerWidthPct: number;
  corrThresholdPct: number;
  attackMs: number;
  releaseMs: number;
  detectorHpfHz: number;
  surroundDelayMs: number;
  surroundHpfHz: number;
  surroundLpfHz: number;
  decorrPct: number;
  presenceDb: number;
}

// Why the upmixer isn't actively processing right now (GetUpmixStatus 0x4E).
export const UpmixParkedReason = {
  Active:         0,
  Disabled:       1,
  NotStereoInput: 2,
  RateAbove48k:   3,
} as const;
export type UpmixParkedReason = (typeof UpmixParkedReason)[keyof typeof UpmixParkedReason];

// Forward-compat: an unrecognised future reason byte reads as Disabled.
export function narrowUpmixParkedReason(n: number): UpmixParkedReason {
  switch (n) {
    case UpmixParkedReason.Active:
    case UpmixParkedReason.Disabled:
    case UpmixParkedReason.NotStereoInput:
    case UpmixParkedReason.RateAbove48k:
      return n;
    default:
      return UpmixParkedReason.Disabled;
  }
}

// Live upmixer status (fw V25+, RP2350 only), reported by GetUpmixStatus
// (0x4E). Pure status (not host-configurable); the bulk packet has no
// equivalent. corr/balance are Q14 signed fixed point, gains are Q15
// unsigned -- kept raw here, matching SpdifRxStatus/I2sSlaveStatus.
export interface UpmixStatus {
  active: boolean;
  parkedReason: UpmixParkedReason;
  corrQ14: number;
  balanceQ14: number;
  centerGainQ15: number;
  lsGainQ15: number;
  rsGainQ15: number;
}

// Subharm selectivity gate (fw V30+): All passes every band; Percussive opens
// on an attack and closes after the hold time; Sustained opens after the hold
// and shuts on an attack. Mirrors fw SUBHARM_SELECT_*.
export const SubharmSelect = { All: 0, Percussive: 1, Sustained: 2 } as const;
export type SubharmSelect = (typeof SubharmSelect)[keyof typeof SubharmSelect];

// Subharmonic synthesizer (fw V29+, both platforms; V30 adds the third band,
// selectivity, ceiling, and pair link). Wire-1:1 like Psybass -- lowDb/highDb/
// topDb of -30 dB mean that band is off; boostDb of 0 skips the LF boost
// bell; ceilingDb of 0 means the sub ceiling is off. outputMask follows the
// same per-output convention as Psybass, default all-on (0xFFFF); never send
// it as 0.
export interface Subharm {
  enabled: boolean;
  outputMask: number;
  lowDb: number;
  highDb: number;
  boostDb: number;
  topDb: number;
  selectMode: SubharmSelect;   // 0 all / 1 percussive / 2 sustained
  selectDepth: number;         // %
  selectHoldMs: number;
  ceilingDb: number;           // 0 = off
  linkPairs: boolean;
}

// Tube preamp valve model (fw V31+). 0 = Custom: bias/asym/hardness/sag are
// user values; 1..16 load those four from the named tube's row, and editing
// any of them flips the type back to Custom fw-side. Keys carry the full
// designation; a `V` (valve) prefix only where the name starts with a digit.
export const TubeType = {
  Custom: 0, V12ax7: 1, V5751: 2, V12at7: 3, V12ay7: 4, V12au7: 5, V6sn7: 6, V6sl7: 7,
  V6dj8: 8, Ef86: 9, V6sj7: 10, El84: 11, El34: 12, V6l6: 13, V6v6: 14, Kt88: 15, V300b: 16,
} as const;
export type TubeType = (typeof TubeType)[keyof typeof TubeType];

// Power-supply rectifier model: drives the sag character.
export const TubeRectifier = { SolidState: 0, Gz34: 1, V5u4: 2, V5y3: 3 } as const;
export type TubeRectifier = (typeof TubeRectifier)[keyof typeof TubeRectifier];

// Tube preamp emulation (fw V31+, both platforms). Wire-1:1 like Subharm.
// outputMask follows the per-output convention of Psybass (bit k = output k),
// default all-on (0xFFFF). xfmrEnabled switches the output-transformer stage.
export interface Tube {
  enabled: boolean;
  tubeType: TubeType;
  rectifier: TubeRectifier;
  xfmrEnabled: boolean;
  outputMask: number;
  driveDb: number;
  biasPct: number;
  asymDb: number;
  hardnessPct: number;
  sagPct: number;
  xfmrDamping: number;
  xfmrResHz: number;
  mixPct: number;
  trimDb: number;
}

// Per-output lookahead limiter (fw V32+, both platforms). linkGroup 0 =
// unlinked; 1..4 gang the group's outputs: fw keeps enable/threshold/release
// identical across members and applies one gain reduction to all of them.
export interface LimiterOutput {
  enabled: boolean;
  linkGroup: number;
  thresholdDb: number;
  releaseMs: number;
}

// Live limiter status block (REQ_LIMITER GET index 0x81). engaged = the
// 32-sample lookahead delay is in the signal path for every output.
export interface LimiterStatus {
  engaged: boolean;
  lookaheadSamples: number;
  blockSamples: number;
  numOutputs: number;
}

// Restore / 0xFF link-group rule (firmware lm_gang_groups): every member of a
// group copies its lowest-numbered member. Not the join rule, see
// joinLimiterGroup. Entries at or past numOut are untouched.
export function settleLimiterGroups(list: LimiterOutput[], numOut: number): LimiterOutput[] {
  const out = list.map((o) => ({ ...o }));
  for (let k = 1; k < Math.min(numOut, out.length); k++) {
    const g = out[k].linkGroup;
    if (g === 0) continue;
    const lead = out.findIndex((o) => o.linkGroup === g);
    if (lead < k) out[k] = { ...out[lead] };
  }
  return out;
}

// Per-output link-group SET (firmware limiter_set_param): the output takes the
// group, and a non-zero group hands it the lowest-numbered OTHER member's
// enable/threshold/release; existing members never change. Leaving (group 0)
// or joining an empty group keeps the output's own settings.
export function joinLimiterGroup(list: LimiterOutput[], output: number, group: number, numOut: number): LimiterOutput[] {
  const out = list.map((o) => ({ ...o }));
  if (!out[output]) return out;
  out[output].linkGroup = group;
  if (group === 0) return out;
  for (let k = 0; k < Math.min(numOut, out.length); k++) {
    if (k === output || out[k].linkGroup !== group) continue;
    const { enabled, thresholdDb, releaseMs } = out[k];
    Object.assign(out[output], { enabled, thresholdDb, releaseMs });
    break;
  }
  return out;
}

// Master volume persistence: 0 = global (persisted via SaveMasterVolume);
// 1 = travels with each preset.
export const MasterVolumeMode = {
  Independent: 0,
  WithPreset:  1,
} as const;
export type MasterVolumeMode = (typeof MasterVolumeMode)[keyof typeof MasterVolumeMode];
