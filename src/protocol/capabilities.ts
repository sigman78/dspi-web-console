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

  // Feature flags drive UI affordances and runtime behavior. Each lands with
  // its feature; keyed on observed wire version unless the firmware gates a
  // command without a wire bump.
  readonly features: {
    readonly notifications: boolean;     // v2 notify channel (wire >= 7)
    readonly inputSourceSwitch: boolean; // USB/S-PDIF source select (wire >= 7)
    readonly spdifRx: boolean;           // S/PDIF receiver (wire >= 7)
    readonly lgSoundSync: boolean;       // LG Sound Sync (wire >= 8)
    readonly userVolumeAxis: boolean;    // separate user volume/mute (wire >= 9)
    readonly dacHwMute: boolean;         // DAC hardware mute config (wire >= 10)
    readonly bandBypass: boolean;        // per-band EQ bypass byte honored (wire >= 10)
    readonly notchFilter: boolean;       // FilterType.Notch (wire >= 10)
    readonly allpassFilter: boolean;     // FilterType.Allpass (wire >= 10)
    readonly outputConfigSave: boolean;  // SaveOutputConfig flash write (wire >= 10)
  };
}

// Minimum observed wire version each capability flag requires. Single source
// for both the feature-flag derivation in deriveCapabilities() and the
// UnsupportedOnFirmware requirement label in DspDevice. Adding a feature to
// DeviceCapabilities['features'] without an entry here is a compile error.
export const FEATURE_MIN_WIRE: Record<keyof DeviceCapabilities['features'], number> = {
  notifications:     NOTIFY_MIN_WIRE,
  inputSourceSwitch: 7,
  spdifRx:           7,
  lgSoundSync:       8,
  userVolumeAxis:    9,
  dacHwMute:         10,
  bandBypass:        10,
  notchFilter:       10,
  allpassFilter:     10,
  outputConfigSave:  10,
};

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
    features: Object.fromEntries(
      (Object.keys(FEATURE_MIN_WIRE) as (keyof DeviceCapabilities['features'])[])
        .map((key) => [key, wireVersion >= FEATURE_MIN_WIRE[key]]),
    ) as DeviceCapabilities['features'],
  };
}

// A snapshot of wire version `sourceWire` is writable to a device with these
// capabilities iff the firmware would merge it
export function acceptsWriteFormat(caps: DeviceCapabilities, sourceWire: number): boolean {
  return sourceWire >= MIN_SUPPORTED_WIRE && sourceWire <= caps.wire;
}
