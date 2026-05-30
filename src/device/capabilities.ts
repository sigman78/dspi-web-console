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
  };
}
