// DSP processing blocks. Mirrors bulk_params.h sections 3 (crossfeed),
// 12 (leveller), and the global-params loudness fields.

export interface Loudness {
  enabled: boolean;
  refSpl: number;
  intensityPct: number;
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
