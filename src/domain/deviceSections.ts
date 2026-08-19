// Domain shapes for the bulk sections firmware 1.1.4 appended (wire V7-V10).
// Each is surfaced on DspSnapshot as nullable -- present only when the device's
// packet carries the section (see protocol/snapshotCodec.ts gating on bulkLayout).

export const AudioInputSource = {
  Usb:    0,
  Spdif:  1,
  I2s:    2,   // V16+
  // Structurally valid on both platforms (V24+ wire) so presets round-trip;
  // selectability is gated separately and not yet exposed in the UI.
  Adat:   3,
  Spdif2: 4,   // fw 1.1.5+ selectable S/PDIF input 2
  Spdif3: 5,   // fw 1.1.5+ selectable S/PDIF input 3
} as const;
export type AudioInputSource = (typeof AudioInputSource)[keyof typeof AudioInputSource];

export function isSpdifSource(s: AudioInputSource): boolean {
  return s === AudioInputSource.Spdif || s === AudioInputSource.Spdif2 || s === AudioInputSource.Spdif3;
}

// One S/PDIF receiver, up to 3 selectable input GPIOs (input 1 + two optional).
export const SPDIF_RX_MAX_INSTANCES = 3;

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
  // fw 1.1.5+ optional S/PDIF inputs 2/3 (index 0 = input 2, index 1 = input 3).
  // GPIO per input; 0 = unset.
  spdifRxPinExt: number[];
  // Whether inputs 2/3 are enabled.
  spdifExtEnabled: boolean[];
  // I2S clock role (fw V21+): 0 = master (legacy default), 1 = slave.
  i2sClockMode: number;
  // ADAT input (fw V24+, RP2350). pin: GPIO, 0 = absent/keep-live. enabled/
  // clockMode collapse the wire's "absent" sentinel to the same default as
  // i2sClockMode (false / master) -- gated devices (features.adatInput)
  // always report a real value, so the collapse only matters pre-V24.
  adatInputPin: number;
  adatInputEnabled: boolean;
  adatInputClockMode: number;  // 0 = master, 1 = slave
}

// V17 -- ADAT lightpipe bulk output config (RP2350 only). Persisted intent;
// pin 0 means platform default (GPIO 12).
export interface AdatOutputConfig {
  enabled: boolean;
  pin: number;
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

// V21 -- live I2S slave-clock lock state, reported by GetI2sSlaveStatus
// (0x8A). Note the state ordering differs from SpdifInputState (Relocking
// precedes Locked here) -- this mirrors the firmware enum, not a typo.
export const I2sSlaveClockState = {
  Inactive:  0,
  Acquiring: 1,
  Relocking: 2,
  Locked:    3,
} as const;
export type I2sSlaveClockState = (typeof I2sSlaveClockState)[keyof typeof I2sSlaveClockState];

// Forward-compat: an unrecognised future state byte reads as Inactive.
export function narrowI2sSlaveClockState(n: number): I2sSlaveClockState {
  switch (n) {
    case I2sSlaveClockState.Inactive:
    case I2sSlaveClockState.Acquiring:
    case I2sSlaveClockState.Relocking:
    case I2sSlaveClockState.Locked:
      return n;
    default:
      return I2sSlaveClockState.Inactive;
  }
}

// Live I2S slave-clock telemetry. Pure status (not host-configurable); the
// bulk packet has no equivalent, so this is read-only via the granular opcode.
export interface I2sSlaveStatus {
  state: I2sSlaveClockState;
  clockMode: number;
  lockCount: number;
  lossCount: number;
  detectedRateHz: number;
  measuredHz: number;
  slipCount: number;
}

// Live ADAT lightpipe output telemetry (GetAdatStatus 0xCE, fw V17+, RP2350
// only). `enabled` is persisted intent, `active` is running now. `rateOk`
// reflects whether the device rate is 44.1/48 kHz -- the stream auto-suspends
// outside that range and resumes when the rate returns.
export interface AdatOutputStatus {
  enabled: boolean;
  active: boolean;
  pin: number;
  rateOk: boolean;
  resyncCount: number;
  slipCount: number;
}

// Selectable system clock (fw overclock branch, REQ_SET/GET_SYS_CLOCK
// 0x40/0x41). No wire/version gate yet -- support is probed via GetSysClock.
export const SysClockMode = {
  Mhz307p2: 0,   // firmware default / safe mode
  Mhz384:   1,
  Mhz480:   2,
} as const;
export type SysClockMode = (typeof SysClockMode)[keyof typeof SysClockMode];

// Forward-compat: an unrecognised future mode byte reads as the safe default.
export function narrowSysClockMode(n: number): SysClockMode {
  switch (n) {
    case SysClockMode.Mhz307p2:
    case SysClockMode.Mhz384:
    case SysClockMode.Mhz480:
      return n;
    default:
      return SysClockMode.Mhz307p2;
  }
}

// vregSel sentinel meaning "use the mode's default voltage".
export const SYS_CLOCK_VREG_DEFAULT = 0xFF;

// Clock speed in MHz, indexed by SysClockMode.
export const SYS_CLOCK_MODE_MHZ = [307.2, 384, 480] as const;

// Mode-default vreg enums, indexed by SysClockMode (fw sys_clock.c table):
// VREG_VOLTAGE_1_15/1_20/1_30. Identical on RP2040 and RP2350.
export const SYS_CLOCK_MODE_DEFAULT_VREG = [12, 13, 15] as const;

// Platform vreg ceilings: VREG_VOLTAGE_1_30 (RP2040 max) / VREG_VOLTAGE_1_50
// (RP2350, POWMAN limit unlocked). Enums from BENCH_MIN up (RP2350 only) are
// flagged bench-only by the fw spec -- stable but outside validated silicon.
export const SYS_CLOCK_VREG_CEILING_RP2040 = 15;
export const SYS_CLOCK_VREG_CEILING_RP2350 = 19;
export const SYS_CLOCK_VREG_BENCH_MIN = 16;

// Raw vreg enum -> volts (vreg_voltage_t spacing: 50 mV/step, 0.55 V base).
export function sysClockVregVolts(sel: number): number {
  return 0.55 + 0.05 * sel;
}

// Live system-clock status. activeMode != storedMode means a crash-fallback
// boot (device rebooted to safe mode 0 after a failed overclock) or an
// unconfirmed runtime switch is in force.
export interface SysClockStatus {
  activeMode: SysClockMode;
  storedMode: SysClockMode;
  storedVregSel: number;
  liveVreg: number;
  fallbackActive: boolean;
}
