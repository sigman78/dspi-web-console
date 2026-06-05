// Domain shapes for the bulk sections firmware 1.1.4 appended (wire V7–V10).
// Each is surfaced on DspSnapshot as nullable — present only when the device's
// packet carries the section (see protocol/snapshotCodec.ts gating on bulkLayout).

export const AudioInputSource = {
  Usb:   0,
  Spdif: 1,
} as const;
export type AudioInputSource = (typeof AudioInputSource)[keyof typeof AudioInputSource];

// V7 — input routing. spdifRxPin is the GPIO the S/PDIF receiver listens on.
export interface InputConfig {
  source: AudioInputSource;
  spdifRxPin: number;
}

// V8 — LG Sound Sync. Only `enabled` is host-configurable; the rest is
// runtime state the device reports.
export interface LgSoundSync {
  enabled: boolean;
  present: boolean;
  volume: number;
  muted: boolean;
}

// V9 — user volume axis (separate from the master-volume limit).
export interface UserVolume {
  volumeDb: number;
  mute: boolean;
}

// V10 — DAC hardware-mute pin configuration.
export interface DacHwMute {
  enabled: boolean;
  activeLow: boolean;
  pin: number;
  holdMs: number;
  releaseMs: number;
}

// V7 — live S/PDIF receiver lock state, reported by GetSpdifRxStatus (0xE2).
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
