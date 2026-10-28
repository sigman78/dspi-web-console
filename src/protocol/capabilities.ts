// Firmware capability derivation. Pure (no I/O): classify what the console can
// do with this device. UI/runtime read the result via `device.capabilities`
// and must never branch on raw fw/wire numbers.
//
// Section presence is derived structurally (wire version + payload length, via
// Wire.bulkLayout) rather than fw semver, since in-development firmwares can
// misreport their semver.

import * as Wire from './wireTypes';
import { SPDIF_RX_MAX_INSTANCES } from '@/domain';

// Support window: V28 (released fw 1.1.5) through V32 (fw 1.1.6). Anything
// older -- the 1.1.4 V10 wire, the V16-V27 betas, the 11..15 intermediates --
// is rejected at connect. V29 adds the subharmonic synthesizer, V30 grows the
// subharm section (third band, selectivity, ceiling, pair link), V31 adds the
// tube preamp, V32 adds the per-output limiter.
export const MAX_KNOWN_WIRE = 32;
const SUPPORTED_WIRE_VERSIONS: readonly number[] = [28, 29, 30, 31, 32];

// UI-facing description of the support window (device-panel tooltips). Keep
// in step with SUPPORTED_WIRE_VERSIONS and the fw releases that carry them.
export const SUPPORT_WINDOW = {
  fw: '1.1.5–1.1.6',
  wire: 'V28–V32',
} as const;

export interface FirmwareVersion {
  major: number;
  minor: number;
  patch: number;
  // Pre-release ordinal from GetPlatform byte 6 (FW_VERSION_BETA, fw
  // 1.1.6-beta3+): 1..255 on a beta build. Absent or 0 means a final release,
  // which is also how firmware predating the byte reads. Display only --
  // nothing gates on it, and `support` stays a wire-version decision.
  beta?: number;
}

// Feature flags for surfaces that still vary among supported devices: RP2350-
// only hardware and the V29+ wire additions. UI gates on these, never on wire
// numbers.
export interface DeviceFeatures {
  // More than one input stereo pair: 4/6/8-channel USB alts and multichannel
  // I2S (SetI2sInputChannels / pair-addressed RX pins). RP2350 only.
  readonly multichannelInput: boolean;
  // Multiple selectable S/PDIF inputs sharing one receiver (RP2350 only,
  // same platform gate as multichannelInput).
  readonly multiSpdifInputs: boolean;
  // ADAT lightpipe bulk output, streaming the 8 post-gain output channels
  // (0xCA-0xCE + WireBulkParams.adat). RP2350 only -- same platform gate as
  // adatInput below.
  readonly adatOutput: boolean;
  // Psychoacoustic bass (0x30-0x3D + WirePsybassParams). RP2350 only.
  readonly psybass: boolean;
  // ADAT input (0x68-0x6E + InputConfig's ADAT fields). RP2350 only --
  // mirrors firmware's platform gate on the ADAT lightpipe hardware.
  readonly adatInput: boolean;
  // Stereo upmixer (WireUpmixParams), including the presence bell and the
  // centre-mode OFF option. RP2350 only.
  readonly upmix: boolean;
  // Subharmonic synthesizer (0x10-0x1A + WireSubharmParams). Wire V29+, both
  // platforms -- the kernel runs in Q28 on RP2040, so no platform gate unlike
  // psybass/upmix.
  readonly subharm: boolean;
  // Subharm section tail (wire V30+): third band, selectivity, ceiling, pair
  // link.
  readonly subharmExt: boolean;
  // Tube preamp emulation (wire V31+, both platforms).
  readonly tube: boolean;
  // Per-output limiter (wire V32+, both platforms).
  readonly limiter: boolean;
  // GetBuildInfo 0x80 answers (wire V29+). Provenance for humans only -- the
  // stamp itself never gates anything; this only says the read is worth trying.
  readonly buildStamp: boolean;
}

export interface DeviceCapabilities {
  // Metadata / escape hatch. Surfaced for display (e.g. the reject message) and
  // for future wire-invisible feature gating. UI must not branch on these.
  readonly fw: FirmwareVersion;
  readonly fwLabel: string;       // "1.1.5" -- formatted once, here
  readonly wire: number;
  readonly wireLabel: string;     // "V28"   -- formatted once, here
  readonly platformId: number;

  // Support classification, keyed on the observed wire version:
  //   unsupported -- below the V28 floor (older than fw 1.1.5).
  //   supported   -- V28-V32 (1.1.5/1.1.6).
  //   future      -- newer than the console knows; read known sections only.
  readonly support: 'unsupported' | 'supported' | 'future';

  // Which bulk-packet sections this device's packet carries. Single source of
  // truth -- wraps Wire.bulkLayout, never a parallel re-derivation.
  readonly sections: Wire.BulkLayout;

  readonly features: DeviceFeatures;

  // Number of selectable S/PDIF inputs (1 unless multiSpdifInputs is set,
  // then SPDIF_RX_MAX_INSTANCES). Numeric sibling of features.multiSpdifInputs
  // -- DeviceFeatures stays boolean-only.
  readonly spdifInputCount: number;
}

// The single firmware-version string formatter. Display reads this projection
// off the frozen authority -- never re-derives the version itself.
function formatFirmwareVersion(fw: FirmwareVersion): string {
  const release = `${fw.major}.${fw.minor}.${fw.patch}`;
  return fw.beta ? `${release} beta ${fw.beta}` : release;
}

export function deriveCapabilities(input: {
  fw: FirmwareVersion;
  wireVersion: number;
  payloadLength: number;
  platformId: number;
}): DeviceCapabilities {
  const { fw, wireVersion, payloadLength, platformId } = input;

  const support: DeviceCapabilities['support'] =
    SUPPORTED_WIRE_VERSIONS.includes(wireVersion) ? 'supported'
    : wireVersion > MAX_KNOWN_WIRE                ? 'future'
    : 'unsupported';

  const multiSpdifInputs = platformId === 1;

  return {
    fw,
    fwLabel: formatFirmwareVersion(fw),
    wire: wireVersion,
    wireLabel: `V${wireVersion}`,
    platformId,
    support,
    sections: Wire.bulkLayout({ formatVersion: wireVersion, payloadLength }),
    features: {
      multichannelInput: platformId === 1,
      multiSpdifInputs,
      adatOutput:        platformId === 1,
      psybass:           platformId === 1,
      adatInput:         platformId === 1,
      upmix:             platformId === 1,
      subharm:           wireVersion >= 29,
      subharmExt:        wireVersion >= 30,
      tube:              wireVersion >= 31,
      limiter:           wireVersion >= 32,
      buildStamp:        wireVersion >= 29,
    },
    spdifInputCount: multiSpdifInputs ? SPDIF_RX_MAX_INSTANCES : 1,
  };
}
