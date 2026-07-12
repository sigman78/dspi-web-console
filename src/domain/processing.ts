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

// Master volume persistence: 0 = global (persisted via SaveMasterVolume);
// 1 = travels with each preset.
export const MasterVolumeMode = {
  Independent: 0,
  WithPreset:  1,
} as const;
export type MasterVolumeMode = (typeof MasterVolumeMode)[keyof typeof MasterVolumeMode];
