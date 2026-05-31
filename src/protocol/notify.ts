// Notification Protocol v2 packet decoder (read-only). See
// docs/HW-NOTIFICATIONS.md. Returns a discriminated NotifyEvent; PARAM_CHANGED
// carries its decoded payload (offset/size/value), and malformed, short, or
// non-v2 frames degrade to { kind: 'ignored' } rather than throw.

import { Codec } from '@/utils';

export const NOTIFY_PACKET_SIZE = 64;   // EP 0x83 wMaxPacketSize
export const NOTIFY_V2_VERSION = 2;

export const NotifyEventId = {
  Idle:            0x00,
  MasterVolumeV1:  0x01,
  ParamChanged:    0x02,
  BulkInvalidated: 0x03,
  PresetLoaded:    0x04,
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
} as const;

export type NotifyEvent =
  | { kind: 'idle' }
  | { kind: 'ignored' }                                        // v1 / unknown / malformed
  | { kind: 'paramChanged';    seq: number; source: number; offset: number; size: number; value: Uint8Array }
  | { kind: 'bulkInvalidated'; seq: number; source: number }
  | { kind: 'presetLoaded';    seq: number; slot: number };

export type ParamChangedEvent = Extract<NotifyEvent, { kind: 'paramChanged' }>;

const { u8, u16, reserved, struct } = Codec;

// v2 frame header (4 B). `flags` (byte 2) is unused by the console.
const NotifyHeader = struct({ version: u8, event: u8, _flags: reserved(1), seq: u8 });

// PARAM_CHANGED fixed prefix (8 B) after the header: little-endian offset and
// size, the source byte, then 3 reserved. The variable `value` (size bytes)
// follows at byte 12 and is sliced manually — its length is data-dependent, so
// it can't be a static codec field.
const ParamChangedPrefix = struct({ offset: u16, size: u16, source: u8, _reserved: reserved(3) });

// Value-less events: the discriminant carries no data and NotifyEvents are only
// ever read, so a shared singleton per kind is safe.
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
      if (bytes.length < 12) return IGNORED;
      const p = Codec.decode(ParamChangedPrefix, bytes.subarray(4));
      if (bytes.length < 12 + p.size) return IGNORED;   // declared value overruns the packet
      return { kind: 'paramChanged', seq: h.seq, source: p.source, offset: p.offset, size: p.size, value: bytes.subarray(12, 12 + p.size) };
    }
    case NotifyEventId.BulkInvalidated:
      return { kind: 'bulkInvalidated', seq: h.seq, source: bytes.length > 4 ? bytes[4] : 0 };
    case NotifyEventId.PresetLoaded:
      return { kind: 'presetLoaded', seq: h.seq, slot: bytes.length > 4 ? bytes[4] : 0 };
    default:
      return IGNORED;
  }
}

// Whether this event means device state changed out from under us and the
// mirror should re-read the bulk packet. HOST echoes are suppressed — our
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
// (Load / Paste / Save / Factory). While the console runs such an op — which
// does its own authoritative re-fetch — the NotifyChannel suppresses these to
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
