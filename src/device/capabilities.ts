// Firmware capability derivation. Pure (no I/O): given the four numbers read at
// connect, classify what the console can do with this device. UI/runtime read
// the result via `device.capabilities` and must never branch on raw fw/wire
// numbers themselves.
//
// Section presence is derived structurally (observed wire version + payload
// length, via Wire.bulkLayout) rather than from fw semver — the robust signal,
// since in-development firmwares can misreport their semver. Feature flags (for
// 1.1.4 opcodes) are added here per-feature when they land; the foundation
// carries none yet.

import { Wire } from '@/protocol';

// Floor: V6 ships with fw 1.1.3, the minimum the console supports. Ceiling:
// V10 is the 1.1.4 development branch — the newest wire shape the console knows.
export const MIN_SUPPORTED_WIRE = 6;
export const MAX_KNOWN_WIRE = 10;

// Notification Protocol v2 requires the V7 bulk bump; devices below this wire have no v2 notify channel.
export const NOTIFY_MIN_WIRE = 7;

export interface FirmwareVersion {
  major: number;
  minor: number;
  patch: number;
}

export interface DeviceCapabilities {
  // Metadata / escape hatch. Surfaced for display (e.g. the reject message) and
  // for future wire-invisible feature gating. UI must not branch on these.
  readonly fw: FirmwareVersion;
  readonly wire: number;
  readonly platformId: number;

  // Support classification, keyed on the observed wire version:
  //   unsupported — older than the V6 floor; connect is rejected.
  //   supported   — V6 (1.1.3) through V10 (1.1.4 branch).
  //   future      — newer than the console knows; read known sections only.
  readonly support: 'unsupported' | 'supported' | 'future';

  // Which bulk-packet sections this device's packet carries. Single source of
  // truth — wraps Wire.bulkLayout, never a parallel re-derivation.
  readonly sections: Wire.BulkLayout;

  // Feature flags drive UI affordances and runtime behavior. Each lands with
  // its feature; keyed on observed wire version unless the firmware gates a
  // command without a wire bump.
  readonly features: {
    readonly notifications: boolean;   // v2 notify channel (wire >= 7)
  };
}

export function deriveCapabilities(input: {
  fw: FirmwareVersion;
  wireVersion: number;
  payloadLength: number;
  platformId: number;
}): DeviceCapabilities {
  const { fw, wireVersion, payloadLength, platformId } = input;

  const support: DeviceCapabilities['support'] =
    wireVersion < MIN_SUPPORTED_WIRE ? 'unsupported'
    : wireVersion > MAX_KNOWN_WIRE   ? 'future'
    : 'supported';

  return {
    fw,
    wire: wireVersion,
    platformId,
    support,
    sections: Wire.bulkLayout({ formatVersion: wireVersion, payloadLength }),
    features: {
      notifications: wireVersion >= NOTIFY_MIN_WIRE,
    },
  };
}

// A snapshot of wire version `sourceWire` is writable to a device with these
// capabilities iff the firmware would merge it: format_version <= device's wire.
// Equal/lower merges (absent sections left untouched); higher is rejected by the
// firmware (bulk_params.c). Holds for `future` devices too — option C keeps
// too-new devices writable at the known wire rather than going read-only.
export function acceptsWriteFormat(caps: DeviceCapabilities, sourceWire: number): boolean {
  return sourceWire >= MIN_SUPPORTED_WIRE && sourceWire <= caps.wire;
}
