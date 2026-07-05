// Domain shapes for the bulk sections firmware 1.1.4 appended (wire V7-V10).
// Each is surfaced on DspSnapshot as nullable -- present only when the device's
// packet carries the section (see protocol/snapshotCodec.ts gating on bulkLayout).

export const AudioInputSource = {
  Usb:   0,
  Spdif: 1,
  I2s:   2,   // V16+
} as const;
export type AudioInputSource = (typeof AudioInputSource)[keyof typeof AudioInputSource];

// Maximum I2S RX stereo pairs on the largest platform (RP2350; RP2040 has 1).
export const I2S_RX_MAX_PAIRS = 4;

// I2S input sample rates the firmware accepts (device is the rate authority
// while I2S input is active). Wire/flash encoding: 0=44100, 1=48000, 2=96000.
export const I2S_INPUT_RATES_HZ = [44100, 48000, 96000] as const;

export function i2sRateDecode(enc: number): number {
  return enc === 0 ? 44100 : enc === 2 ? 96000 : 48000;
}

export function i2sRateEncode(hz: number): number {
  return hz === 44100 ? 0 : hz === 96000 ? 2 : 1;
}

// V7 -- input routing. spdifRxPin is the GPIO the S/PDIF receiver listens on.
// The i2s* fields are V16+; on a V10 device they read as zeros ("absent")
// and are surfaced only behind the i2sInput capability.
export interface InputConfig {
  source: AudioInputSource;
  spdifRxPin: number;
  // I2S RX data GPIO per stereo pair (pair 0 first; 0 = unset).
  i2sRxPins: number[];
  // Selected I2S input rate in Hz (decoded from the wire enum).
  i2sInputRateHz: number;
  // Active I2S input channel count: 2/4/6/8 (0 = firmware default / absent).
  i2sInputChannels: number;
}

// V8 -- LG Sound Sync. Only `enabled` is host-configurable; the rest is
// runtime state the device reports.
export interface LgSoundSync {
  enabled: boolean;
  present: boolean;
  volume: number;
  muted: boolean;
}

// V9 -- user volume axis (separate from the master-volume limit).
export interface UserVolume {
  volumeDb: number;
  mute: boolean;
}

// V10 -- DAC hardware-mute pin configuration.
export interface DacHwMute {
  enabled: boolean;
  activeLow: boolean;
  pin: number;
  holdMs: number;
  releaseMs: number;
}

// V7 -- live S/PDIF receiver lock state, reported by GetSpdifRxStatus (0xE2).
export const SpdifInputState = {
  Inactive:  0,
  Acquiring: 1,
  Locked:    2,
  Relocking: 3,
} as const;
export type SpdifInputState = (typeof SpdifInputState)[keyof typeof SpdifInputState];

// Live S/PDIF-RX telemetry. Pure status (not host-configurable); the bulk
// packet has no equivalent, so this is read-only via the granular opcode.
export interface SpdifRxStatus {
  state: SpdifInputState;
  inputSource: AudioInputSource;
  lockCount: number;
  lossCount: number;
  sampleRate: number;
  parityErrors: number;
  fifoFillPct: number;
}
