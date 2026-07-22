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

// Master volume persistence: 0 = global (persisted via SaveMasterVolume);
// 1 = travels with each preset.
export const MasterVolumeMode = {
  Independent: 0,
  WithPreset:  1,
} as const;
export type MasterVolumeMode = (typeof MasterVolumeMode)[keyof typeof MasterVolumeMode];
