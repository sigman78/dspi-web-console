// Notification Protocol v2 packet decoder (read-only). See
// docs/HW-NOTIFICATIONS.md. Returns a discriminated NotifyEvent; PARAM_CHANGED
// carries its decoded payload (offset/size/value), and malformed, short, or
// non-v2 frames degrade to { kind: 'ignored' } rather than throw. Firmware
// stamps one shared seq counter across every v2 event (notify.c), so once the
// header itself parses (length >= 4, version 2), every return path --
// unknown event ids and truncated/overrun known-event bodies included --
// carries seq: h.seq. A decoded-but-dropped frame that didn't preserve its
// seq would silently eat a counter value the consumer never sees, making the
// next event misread as a gap and force a spurious full reconcile. Frames
// that fail before the header parses (too short, non-v2 version) stay
// seq-less, same as before.

import { Codec } from '@/utils';

export const NOTIFY_PACKET_SIZE = 64;   // EP 0x83 wMaxPacketSize
export const NOTIFY_V2_VERSION = 2;

export const NotifyEventId = {
  Idle:            0x00,
  MasterVolumeV1:  0x01,
  ParamChanged:    0x02,
  BulkInvalidated: 0x03,
  PresetLoaded:    0x04,
  InputFormat:     0x05,   // V16+: active input channel count changed
  SiggenState:     0x07,   // V16+: test signal generator start/stop/completion
  AdatState:       0x08,   // V17+: ADAT bulk-output stream state changed (RP2350)
  CsIrLearn:       0x0A,   // V16+ (fw 1.1.5 caps v3): IR learn armed -> done/timeout
  I2sSlaveState:   0x09,   // V21+: I2S slave-clock lock state changed
  AdatInputState:  0x0B,   // V24+: ADAT input lock state changed
} as const;

export const ParamSource = {
  Unknown:  0,
  Host:     1,
  Bulk:     2,
  Preset:   3,
  Factory:  4,
  Gpio:     5,
  Internal: 6,
  Uac1:     7,
  Uart:     8,
  I2c:      9,
} as const;

export type NotifyEvent =
  | { kind: 'idle' }
  | { kind: 'ignored'; seq?: number }                          // v1 / unknown / malformed; seq present once the v2 header parsed
  | { kind: 'paramChanged';    seq: number; source: number; offset: number; size: number; value: Uint8Array }
  | { kind: 'bulkInvalidated'; seq: number; source: number }
  | { kind: 'presetLoaded';    seq: number; slot: number }
  // Active input channel count changed (host switched the USB alt, or the
  // I2S channel count changed live). Not bulk-borne: consumers re-layout
  // input-count-dependent UI rather than re-reading the packet.
  | { kind: 'inputFormat';     seq: number; channels: number }
  // Test signal generator start/stop/completion. Silent no-op for now --
  // no UI surfaces the generator yet.
  | { kind: 'siggenState';     seq: number; state: number; reason: number; signalType: number; channel: number }
  // ADAT bulk-output stream state changed (RP2350), including rate-policy
  // auto-suspend/resume. Pure runtime telemetry -- config changes go through
  // PARAM_CHANGED at the adat_config bulk offsets instead. Silent no-op.
  | { kind: 'adatState';       seq: number; enabled: boolean; active: boolean; pin: number }
  // Completion of an armed IR learn (section 3.6.1): exactly one push per
  // completed arm, none on cancel. state 2 = done (protocol/code valid), 3 =
  // timeout (protocol/code 0).
  | { kind: 'csIrLearn';       seq: number; state: number; protocol: number; code: number }
  // I2S slave-clock lock state changed (V21+). rateHz is the detected input
  // rate, 0 until state is LOCKED.
  | { kind: 'i2sSlaveState';   seq: number; state: number; rateHz: number }
  // ADAT input lock state changed (V24+). rateHz is the detected input rate,
  // 0 unless locked. Silent no-op for now -- telemetry wiring lands with the
  // ADAT input UI branch.
  | { kind: 'adatInputState';  seq: number; state: number; rateHz: number; clockMode: number };

export type ParamChangedEvent = Extract<NotifyEvent, { kind: 'paramChanged' }>;

const { u8, u16, u32, bool8, reserved, struct } = Codec;

// v2 frame header (4 B). `flags` (byte 2) is unused by the console.
const NotifyHeader = struct({ version: u8, event: u8, _flags: reserved(1), seq: u8 });

// PARAM_CHANGED fixed prefix (8 B) after the header: little-endian offset and
// size, the source byte, then 3 reserved. The variable `value` (size bytes)
// follows at byte 12 and is sliced manually -- its length is data-dependent, so
// it can't be a static codec field.
const ParamChangedPrefix = struct({ offset: u16, size: u16, source: u8, _reserved: reserved(3) });

// CS_IR_LEARN fixed suffix (8 B) after the header: same shape as the
// CsIrLearn(wValue=2) result read (Wire.CsIrLearnResult), reused here since
// the notify body carries the identical {state, protocol, code} triple.
const CsIrLearnSuffix = struct({ state: u8, protocol: u8, _reserved: reserved(2), code: u32 });

// SIGGEN_STATE fixed suffix (4 B) after the header: {state, reason, signalType, channel}.
const SiggenStateSuffix = struct({ state: u8, reason: u8, signalType: u8, channel: u8 });

// ADAT_STATE fixed suffix (4 B) after the header: {enabled, active, pin, reserved}.
const AdatStateSuffix = struct({ enabled: bool8, active: bool8, pin: u8, _reserved: reserved(1) });

// I2S_SLAVE_STATE fixed suffix (5 B) after the header: {state, rateHz}.
const I2sSlaveStateSuffix = struct({ state: u8, rateHz: u32 });

// ADAT_INPUT_STATE fixed suffix (6 B) after the header: {state, rateHz, clockMode}.
const AdatInputStateSuffix = struct({ state: u8, rateHz: u32, clockMode: u8 });

// Value-less events: NotifyEvents are only ever read, so a shared singleton is safe.
const IDLE: NotifyEvent = { kind: 'idle' };
const IGNORED: NotifyEvent = { kind: 'ignored' };

export function parseNotifyPacket(bytes: Uint8Array): NotifyEvent {
  // The idle keep-alive is always a single 0x00 byte, never a full v2 frame.
  if (bytes.length <= 1) {
    return bytes.length === 1 && bytes[0] === NotifyEventId.Idle ? IDLE : IGNORED;
  }
  if (bytes.length < 4) return IGNORED;   // too short for a v2 header

  const h = Codec.decode(NotifyHeader, bytes);
  if (h.version !== NOTIFY_V2_VERSION) return IGNORED;   // v1 master-volume packets and friends: drop

  switch (h.event) {
    case NotifyEventId.ParamChanged: {
      if (bytes.length < 12) return { kind: 'ignored', seq: h.seq };
      const p = Codec.decode(ParamChangedPrefix, bytes.subarray(4));
      if (bytes.length < 12 + p.size) return { kind: 'ignored', seq: h.seq };   // declared value overruns the packet
      return { kind: 'paramChanged', seq: h.seq, source: p.source, offset: p.offset, size: p.size, value: bytes.subarray(12, 12 + p.size) };
    }
    case NotifyEventId.BulkInvalidated:
      return { kind: 'bulkInvalidated', seq: h.seq, source: bytes.length > 4 ? bytes[4] : 0 };
    case NotifyEventId.PresetLoaded:
      return { kind: 'presetLoaded', seq: h.seq, slot: bytes.length > 4 ? bytes[4] : 0 };
    case NotifyEventId.InputFormat:
      return { kind: 'inputFormat', seq: h.seq, channels: bytes.length > 4 ? bytes[4] : 0 };
    case NotifyEventId.SiggenState: {
      if (bytes.length < 8) return { kind: 'ignored', seq: h.seq };
      const p = Codec.decode(SiggenStateSuffix, bytes.subarray(4));
      return { kind: 'siggenState', seq: h.seq, state: p.state, reason: p.reason, signalType: p.signalType, channel: p.channel };
    }
    case NotifyEventId.AdatState: {
      if (bytes.length < 8) return { kind: 'ignored', seq: h.seq };
      const p = Codec.decode(AdatStateSuffix, bytes.subarray(4));
      return { kind: 'adatState', seq: h.seq, enabled: p.enabled, active: p.active, pin: p.pin };
    }
    case NotifyEventId.CsIrLearn: {
      if (bytes.length < 12) return { kind: 'ignored', seq: h.seq };
      const p = Codec.decode(CsIrLearnSuffix, bytes.subarray(4));
      return { kind: 'csIrLearn', seq: h.seq, state: p.state, protocol: p.protocol, code: p.code };
    }
    case NotifyEventId.I2sSlaveState: {
      if (bytes.length < 9) return { kind: 'ignored', seq: h.seq };
      const p = Codec.decode(I2sSlaveStateSuffix, bytes.subarray(4));
      return { kind: 'i2sSlaveState', seq: h.seq, state: p.state, rateHz: p.rateHz };
    }
    case NotifyEventId.AdatInputState: {
      if (bytes.length < 10) return { kind: 'ignored', seq: h.seq };
      const p = Codec.decode(AdatInputStateSuffix, bytes.subarray(4));
      return { kind: 'adatInputState', seq: h.seq, state: p.state, rateHz: p.rateHz, clockMode: p.clockMode };
    }
    default:
      return { kind: 'ignored', seq: h.seq };
  }
}

// Whether this event means device state changed out from under us and the
// mirror should re-read the bulk packet. HOST echoes are suppressed -- our
// optimistic mirror already holds them.
export function isReconcileTrigger(e: NotifyEvent): boolean {
  switch (e.kind) {
    case 'bulkInvalidated':
    case 'presetLoaded':
      return true;
    case 'paramChanged':
      return e.source !== ParamSource.Host;
    default:
      return false;
  }
}

// Whether this event is a plausible echo of a console-initiated bulk/preset op
// (Load / Paste / Save / Factory). While the console runs such an op -- which
// does its own authoritative re-fetch -- the NotifyChannel suppresses these to
// avoid redundant reconciles. Deliberately narrow: a PARAM_CHANGED is never an
// echo (a GPIO/internal field change must always be reflected), and a
// bulkInvalidated from a non-host-class source is treated as a real external
// invalidation, so only host-initiated invalidation classes are matched. Seq
// gaps are handled separately and always reconcile.
export function isPresetOpEcho(e: NotifyEvent): boolean {
  switch (e.kind) {
    case 'presetLoaded':
      return true;
    case 'bulkInvalidated':
      return e.source === ParamSource.Host
          || e.source === ParamSource.Bulk
          || e.source === ParamSource.Preset
          || e.source === ParamSource.Factory;
    default:
      return false;
  }
}
