// Firmware capability derivation. Pure (no I/O): classify what the console can
// do with this device. UI/runtime read the result via `device.capabilities`
// and must never branch on raw fw/wire numbers.
//
// Section presence is derived structurally (wire version + payload length, via
// Wire.bulkLayout) rather than fw semver, since in-development firmwares can
// misreport their semver.

import * as Wire from './wireTypes';
import { ChannelFamily } from '@/domain';

// Support window: V10 (released fw 1.1.4) and V16-V24 (fw 1.1.5, unified
// channel model; V17 adds ADAT config, V18 adds leveller channel masks, V19
// adds the per-output loudness mask, V20 adds the crossfeed output-pair mask,
// V21 adds I2S slave-clock mode, V22 adds the Linkwitz Transform qp sidecar,
// V23 adds psychoacoustic bass, V24 adds ADAT input config).
// Wire versions 11..15 were in-development intermediates with shifting
// layouts the console never shipped against -- rejected like pre-V10 firmware.
export const MIN_SUPPORTED_WIRE = 10;
export const MAX_KNOWN_WIRE = 24;
const SUPPORTED_WIRE_VERSIONS: readonly number[] = [10, 16, 17, 18, 19, 20, 21, 22, 23, 24];

// UI-facing description of the support window (device-panel tooltips). Keep
// in step with SUPPORTED_WIRE_VERSIONS and the fw releases that carry them.
export const SUPPORT_WINDOW = {
  fw: '1.1.4 and 1.1.5',
  wire: 'V10 and V16–V24',
} as const;

export interface FirmwareVersion {
  major: number;
  minor: number;
  patch: number;
}

// Feature flags for surfaces the V10 floor lacks. UI gates on these, never on
// wire numbers. All are V16-borne; multichannel input additionally needs the
// RP2350's extra stereo pairs (RP2040 stays 2-in on every firmware).
export interface DeviceFeatures {
  // Per-output crossover bands (wire band indices 20..23) + crossover
  // FilterType range 32..63.
  readonly crossover: boolean;
  // First-order PEQ types: Allpass1 / LowShelf1 / HighShelf1 (8..10).
  readonly firstOrderEq: boolean;
  // I2S input source (InputSource 2) with device-authoritative rate and
  // configurable RX data pin(s).
  readonly i2sInput: boolean;
  // More than one input stereo pair: 4/6/8-channel USB alts and multichannel
  // I2S (SetI2sInputChannels / pair-addressed RX pins).
  readonly multichannelInput: boolean;
  // Multiple selectable S/PDIF inputs sharing one receiver (RP2350 only,
  // same platform gate as multichannelInput).
  readonly multiSpdifInputs: boolean;
  // Runtime active-input-count reporting: GetStatus trailing byte, status
  // wValue 23, and the INPUT_FORMAT notify event.
  readonly activeInputCount: boolean;
  // External control interfaces (UART transport + I2C target), configured via
  // 0xF5-0xF9. Landed before the 1.1.5 release; V10 firmware lacks them.
  readonly controlInterfaces: boolean;
  // Control Surfaces: physical controls/indicators on user GPIOs, configured
  // via 0x84-0x87. Same 1.1.5 vintage as controlInterfaces.
  readonly controlSurfaces: boolean;
  // Per-input leveller channel masks (SetLevellerMasks 0xDE + the 20-byte
  // WireLevellerConfig). Wire V18 only -- V16/V17 (incl. 1.1.5-beta3) have the
  // 16-byte leveller with no masks, so the mask controls must stay hidden.
  readonly levellerMasks: boolean;
  // Per-output loudness mask (SetLoudnessMask 0xFA + GlobalParams19). Wire V19
  // only -- earlier firmware has no output-mask field to write to.
  readonly loudnessOutputMask: boolean;
  // Crossfeed output-pair mask (SetCrossfeedOutputs 0xFC + CrossfeedParams20).
  // Wire V20 only -- earlier firmware has no pair-mask field to write to.
  readonly crossfeedPairMask: boolean;
  // I2S slave-clock mode (SetI2sClockMode 0x88 + InputConfig21's clock-mode
  // byte). Wire V21 only -- earlier firmware has no clock-role field.
  readonly i2sSlaveClock: boolean;
  // Linkwitz Transform PEQ band type (FilterType 11 + BandParamsQp's qp
  // sidecar). Wire V22+ only -- earlier firmware has no qp field to write to.
  readonly linkwitzTransform: boolean;
  // Psychoacoustic bass (0x30-0x3D + WirePsybassParams). Wire V23+ only.
  readonly psybass: boolean;
  // ADAT input (0x68-0x6E + InputConfig24's ADAT fields). Wire V24+, RP2350
  // only -- mirrors firmware's platform gate on the ADAT lightpipe hardware.
  readonly adatInput: boolean;
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
  //   unsupported -- below the V10 floor, or an 11..15 in-dev intermediate.
  //   supported   -- V10 (1.1.4) or V16-V21 (1.1.5).
  //   future      -- newer than the console knows; read known sections only.
  readonly support: 'unsupported' | 'supported' | 'future';

  // Channel-model generation the device's packet follows (V16 for future
  // devices too -- newest known shape). Selects codec dims and the hardware
  // profile's wire mapping; everything above reads `features` instead.
  readonly channelModel: ChannelFamily;

  // Which bulk-packet sections this device's packet carries. Single source of
  // truth -- wraps Wire.bulkLayout, never a parallel re-derivation.
  readonly sections: Wire.BulkLayout;

  readonly features: DeviceFeatures;

  // Number of selectable S/PDIF inputs (1 unless multiSpdifInputs is set, then
  // 3). Numeric sibling of features.multiSpdifInputs -- DeviceFeatures stays
  // boolean-only.
  readonly spdifInputCount: number;
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
    SUPPORTED_WIRE_VERSIONS.includes(wireVersion) ? 'supported'
    : wireVersion > MAX_KNOWN_WIRE                ? 'future'
    : 'unsupported';

  const channelModel = wireVersion >= 16 ? ChannelFamily.Unified : ChannelFamily.Legacy;
  const isV16 = channelModel === ChannelFamily.Unified;
  const multiSpdifInputs = isV16 && platformId === 1;

  return {
    fw,
    fwLabel: formatFirmwareVersion(fw),
    wire: wireVersion,
    wireLabel: `V${wireVersion}`,
    platformId,
    support,
    channelModel,
    sections: Wire.bulkLayout({ formatVersion: wireVersion, payloadLength }),
    features: {
      crossover:         isV16,
      firstOrderEq:      isV16,
      i2sInput:          isV16,
      multichannelInput: isV16 && platformId === 1,
      multiSpdifInputs,
      activeInputCount:  isV16,
      controlInterfaces: isV16,
      controlSurfaces:   isV16,
      // Masks are a V18 addition, not just V16-generation -- key on the exact
      // wire version so V16/V17 devices (e.g. 1.1.5-beta3) don't expose them.
      levellerMasks:     wireVersion >= 18,
      loudnessOutputMask: wireVersion >= 19,
      crossfeedPairMask:  wireVersion >= 20,
      i2sSlaveClock:      wireVersion >= 21,
      linkwitzTransform:  wireVersion >= 22,
      psybass:            wireVersion >= 23 && platformId === 1,
      adatInput:          wireVersion >= 24 && platformId === 1,
    },
    spdifInputCount: multiSpdifInputs ? 3 : 1,
  };
}
