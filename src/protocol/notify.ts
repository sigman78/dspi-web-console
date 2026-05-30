// Notification Protocol v2 packet decoder (read-only). See
// docs/HW-NOTIFICATIONS.md. Layer 1 only needs to know whether an event
// warrants a bulk reconcile and its seq (for gap detection); payloads are
// not decoded here.

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
  | { kind: 'paramChanged';    seq: number; source: number }
  | { kind: 'bulkInvalidated'; seq: number; source: number }
  | { kind: 'presetLoaded';    seq: number; slot: number };

export function parseNotifyPacket(bytes: Uint8Array): NotifyEvent {
  // The idle keep-alive is always a single 0x00 byte, never a full v2 frame.
  if (bytes.length <= 1) {
    return bytes.length === 1 && bytes[0] === NotifyEventId.Idle ? { kind: 'idle' } : { kind: 'ignored' };
  }
  if (bytes[0] !== NOTIFY_V2_VERSION || bytes.length < 4) {
    return { kind: 'ignored' };   // v1 master-volume packets and shorts: drop
  }
  const event = bytes[1];
  const seq = bytes[3];
  switch (event) {
    case NotifyEventId.ParamChanged:
      if (bytes.length < 12) return { kind: 'ignored' };
      return { kind: 'paramChanged', seq, source: bytes[8] };
    case NotifyEventId.BulkInvalidated:
      return { kind: 'bulkInvalidated', seq, source: bytes.length > 4 ? bytes[4] : 0 };
    case NotifyEventId.PresetLoaded:
      return { kind: 'presetLoaded', seq, slot: bytes.length > 4 ? bytes[4] : 0 };
    default:
      return { kind: 'ignored' };
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
