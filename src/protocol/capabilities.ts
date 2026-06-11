// Firmware capability derivation. Pure (no I/O): classify what the console can
// do with this device. UI/runtime read the result via `device.capabilities`
// and must never branch on raw fw/wire numbers.
//
// Section presence is derived structurally (wire version + payload length, via
// Wire.bulkLayout) rather than fw semver, since in-development firmwares can
// misreport their semver.

import * as Wire from './wireTypes';

// Floor: V10 ships with released fw 1.1.4 -- the single supported wire shape
// (single-stable policy per docs/FW-VERSIONS.md; 1.1.3/V6 support dropped).
// Ceiling: V10 is also the newest shape the console knows.
export const MIN_SUPPORTED_WIRE = 10;
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
  readonly fwLabel: string;       // "1.1.4" -- formatted once, here
  readonly wire: number;
  readonly wireLabel: string;     // "V10"   -- formatted once, here
  readonly platformId: number;

  // Support classification, keyed on the observed wire version:
  //   unsupported -- older than the V10 floor; connect is rejected.
  //   supported   -- V10 (1.1.4).
  //   future      -- newer than the console knows; read known sections only.
  readonly support: 'unsupported' | 'supported' | 'future';

  // Which bulk-packet sections this device's packet carries. Single source of
  // truth -- wraps Wire.bulkLayout, never a parallel re-derivation.
  readonly sections: Wire.BulkLayout;

  // No per-feature flags: with the single-stable V10 floor, every supported
  // device carries the full 1.1.4 surface. Reintroduce flags only when a
  // newer wire adds features the floor lacks (see docs/FW-VERSIONS.md).
}

// The single firmware-version string formatter. Display reads this projection
// off the frozen authority -- never re-derives the version itself.
function formatFirmwareVersion(fw: FirmwareVersion): string {
  return `${fw.major}.${fw.minor}.${fw.patch}`;
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
    fwLabel: formatFirmwareVersion(fw),
    wire: wireVersion,
    wireLabel: `V${wireVersion}`,
    platformId,
    support,
    sections: Wire.bulkLayout({ formatVersion: wireVersion, payloadLength }),
  };
}
