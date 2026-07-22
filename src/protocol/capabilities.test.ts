import { describe, it, expect } from 'vitest';
import { deriveCapabilities, MAX_KNOWN_WIRE } from './capabilities';
import { Wire } from '@/protocol';
import { ChannelFamily } from '@/domain';

const fw = (major: number, minor: number, patch: number) => ({ major, minor, patch });

describe('deriveCapabilities — support classification', () => {
  it('rejects firmware below the V10 floor as unsupported', () => {
    const c = deriveCapabilities({ fw: fw(1, 1, 3), wireVersion: 6, payloadLength: 2896, platformId: 1 });
    expect(c.support).toBe('unsupported');
  });

  it('rejects the last pre-release wire (V9) as unsupported', () => {
    const c = deriveCapabilities({ fw: fw(1, 1, 4), wireVersion: 9, payloadLength: 2944, platformId: 1 });
    expect(c.support).toBe('unsupported');
  });

  it('classifies released 1.1.4 (V10) as supported', () => {
    const c = deriveCapabilities({ fw: fw(1, 1, 4), wireVersion: 10, payloadLength: 2960, platformId: 1 });
    expect(c.support).toBe('supported');
  });

  it('classifies a wire version beyond MAX_KNOWN_WIRE as future', () => {
    const c = deriveCapabilities({ fw: fw(1, 2, 0), wireVersion: MAX_KNOWN_WIRE + 1, payloadLength: 6000, platformId: 1 });
    expect(c.support).toBe('future');
    expect(c.channelModel).toBe(ChannelFamily.Unified);
  });

  it('classifies V16 (1.1.5 unified channel model) as supported', () => {
    const c = deriveCapabilities({ fw: fw(1, 1, 5), wireVersion: 16, payloadLength: Wire.BULK_SIZE_V16, platformId: 1 });
    expect(c.support).toBe('supported');
    expect(c.channelModel).toBe(ChannelFamily.Unified);
    expect(c.sections.crossover).toBe(true);
  });

  it('rejects the 11..15 in-development intermediates', () => {
    for (const v of [11, 12, 15]) {
      const c = deriveCapabilities({ fw: fw(1, 1, 4), wireVersion: v, payloadLength: 3664, platformId: 1 });
      expect(c.support).toBe('unsupported');
    }
  });

  it('classifies V19..V26 as supported; V27 reports future', () => {
    expect(deriveCapabilities({ fw: fw(1, 1, 5), wireVersion: 19, payloadLength: Wire.BULK_SIZE_V19, platformId: 1 }).support).toBe('supported');
    expect(deriveCapabilities({ fw: fw(1, 1, 5), wireVersion: 20, payloadLength: Wire.BULK_SIZE_V20, platformId: 1 }).support).toBe('supported');
    expect(deriveCapabilities({ fw: fw(1, 1, 5), wireVersion: 21, payloadLength: Wire.BULK_SIZE_V21, platformId: 1 }).support).toBe('supported');
    expect(deriveCapabilities({ fw: fw(1, 2, 0), wireVersion: 22, payloadLength: Wire.BULK_SIZE_V22, platformId: 1 }).support).toBe('supported');
    expect(deriveCapabilities({ fw: fw(1, 2, 0), wireVersion: 23, payloadLength: Wire.BULK_SIZE_V23, platformId: 1 }).support).toBe('supported');
    expect(deriveCapabilities({ fw: fw(1, 2, 0), wireVersion: 24, payloadLength: Wire.BULK_SIZE_V24, platformId: 1 }).support).toBe('supported');
    expect(deriveCapabilities({ fw: fw(1, 2, 0), wireVersion: 25, payloadLength: Wire.BULK_SIZE_V25, platformId: 1 }).support).toBe('supported');
    expect(deriveCapabilities({ fw: fw(1, 2, 0), wireVersion: 26, payloadLength: Wire.BULK_SIZE_V26, platformId: 1 }).support).toBe('supported');
    expect(deriveCapabilities({ fw: fw(1, 2, 0), wireVersion: 27, payloadLength: Wire.BULK_SIZE_V26, platformId: 1 }).support).toBe('future');
  });
});

describe('deriveCapabilities — V16 feature flags', () => {
  it('V10 devices expose no V16 features', () => {
    const c = deriveCapabilities({ fw: fw(1, 1, 4), wireVersion: 10, payloadLength: 2960, platformId: 1 });
    expect(c.channelModel).toBe(ChannelFamily.Legacy);
    expect(c.features.crossover).toBe(false);
    expect(c.features.i2sInput).toBe(false);
    expect(c.features.multichannelInput).toBe(false);
    expect(c.features.activeInputCount).toBe(false);
  });

  it('V16 RP2350 gets the full feature set including multichannel input', () => {
    const c = deriveCapabilities({ fw: fw(1, 1, 5), wireVersion: 16, payloadLength: Wire.BULK_SIZE_V16, platformId: 1 });
    expect(c.features.crossover).toBe(true);
    expect(c.features.firstOrderEq).toBe(true);
    expect(c.features.i2sInput).toBe(true);
    expect(c.features.multichannelInput).toBe(true);
    expect(c.features.activeInputCount).toBe(true);
  });

  it('V16 RP2040 gets I2S input but not multichannel (stereo-only part)', () => {
    const c = deriveCapabilities({ fw: fw(1, 1, 5), wireVersion: 16, payloadLength: Wire.BULK_SIZE_V16, platformId: 0 });
    expect(c.features.i2sInput).toBe(true);
    expect(c.features.multichannelInput).toBe(false);
  });

  it('V16 RP2350 gets multiple selectable S/PDIF inputs, mirroring multichannelInput', () => {
    const c = deriveCapabilities({ fw: fw(1, 1, 5), wireVersion: 16, payloadLength: Wire.BULK_SIZE_V16, platformId: 1 });
    expect(c.features.multiSpdifInputs).toBe(true);
    expect(c.spdifInputCount).toBe(3);
  });

  it('V16 RP2040 stays single-S/PDIF-input (stereo-only part)', () => {
    const c = deriveCapabilities({ fw: fw(1, 1, 5), wireVersion: 16, payloadLength: Wire.BULK_SIZE_V16, platformId: 0 });
    expect(c.features.multiSpdifInputs).toBe(false);
    expect(c.spdifInputCount).toBe(1);
  });

  it('V10 (1.1.4) devices stay single-S/PDIF-input regardless of platform', () => {
    const c = deriveCapabilities({ fw: fw(1, 1, 4), wireVersion: 10, payloadLength: 2960, platformId: 1 });
    expect(c.features.multiSpdifInputs).toBe(false);
    expect(c.spdifInputCount).toBe(1);
  });

  it('gates leveller channel masks on wire V18 (off for V16/V17, on for V18)', () => {
    const at = (v: number, len: number) =>
      deriveCapabilities({ fw: fw(1, 1, 5), wireVersion: v, payloadLength: len, platformId: 1 }).features.levellerMasks;
    expect(at(16, Wire.BULK_SIZE_V16)).toBe(false);
    expect(at(17, Wire.BULK_SIZE_V17)).toBe(false);   // 1.1.5-beta3
    expect(at(18, Wire.BULK_SIZE_V18)).toBe(true);
  });

  it('gates the loudness output mask on wire V19 (off through V18, on for V19+)', () => {
    const at = (v: number) =>
      deriveCapabilities({ fw: fw(1, 1, 5), wireVersion: v, payloadLength: Wire.BULK_SIZE_V19, platformId: 1 }).features.loudnessOutputMask;
    expect(at(18)).toBe(false);
    expect(at(19)).toBe(true);
    expect(at(20)).toBe(true);
  });

  it('gates the crossfeed output-pair mask on wire V20 (off through V19, on for V20)', () => {
    const at = (v: number) =>
      deriveCapabilities({ fw: fw(1, 1, 5), wireVersion: v, payloadLength: Wire.BULK_SIZE_V20, platformId: 1 }).features.crossfeedPairMask;
    expect(at(19)).toBe(false);
    expect(at(20)).toBe(true);
  });

  it('gates I2S slave-clock mode on wire V21 (off through V20, on for V21)', () => {
    const at = (v: number) =>
      deriveCapabilities({ fw: fw(1, 1, 5), wireVersion: v, payloadLength: Wire.BULK_SIZE_V21, platformId: 1 }).features.i2sSlaveClock;
    expect(at(20)).toBe(false);
    expect(at(21)).toBe(true);
  });

  it('gates the Linkwitz Transform feature on wire V22 (off through V21, on for V22+)', () => {
    const at = (v: number, len: number) =>
      deriveCapabilities({ fw: fw(1, 2, 0), wireVersion: v, payloadLength: len, platformId: 1 }).features.linkwitzTransform;
    expect(at(21, Wire.BULK_SIZE_V21)).toBe(false);
    expect(at(22, Wire.BULK_SIZE_V22)).toBe(true);
  });

  it('gates psybass on wire V23 + RP2350 (off through V22, off on RP2040, on for V23 RP2350)', () => {
    const at = (v: number, len: number, platformId: number) =>
      deriveCapabilities({ fw: fw(1, 2, 0), wireVersion: v, payloadLength: len, platformId }).features.psybass;
    expect(at(22, Wire.BULK_SIZE_V22, 1)).toBe(false);
    expect(at(23, Wire.BULK_SIZE_V23, 0)).toBe(false);
    expect(at(23, Wire.BULK_SIZE_V23, 1)).toBe(true);
  });

  it('gates ADAT input on wire V24 + RP2350 (off on V23, off on RP2040, on for V24 RP2350)', () => {
    const at = (v: number, platformId: number) =>
      deriveCapabilities({ fw: fw(1, 2, 0), wireVersion: v, payloadLength: Wire.BULK_SIZE_V24, platformId }).features.adatInput;
    expect(at(23, 1)).toBe(false);
    expect(at(24, 0)).toBe(false);
    expect(at(24, 1)).toBe(true);
  });

  it('gates the upmixer on wire V25 + RP2350 (off through V24, off on RP2040, on for V25 RP2350)', () => {
    const at = (v: number, len: number, platformId: number) =>
      deriveCapabilities({ fw: fw(1, 2, 0), wireVersion: v, payloadLength: len, platformId }).features.upmix;
    expect(at(24, Wire.BULK_SIZE_V24, 1)).toBe(false);
    expect(at(25, Wire.BULK_SIZE_V25, 0)).toBe(false);
    expect(at(25, Wire.BULK_SIZE_V25, 1)).toBe(true);
  });

  it('gates upmixer presence on wire V26 + RP2350 (off on V25, off on RP2040, on for V26 RP2350)', () => {
    const at = (v: number, platformId: number) =>
      deriveCapabilities({ fw: fw(1, 2, 0), wireVersion: v, payloadLength: Wire.BULK_SIZE_V26, platformId }).features.upmixPresence;
    expect(at(25, 1)).toBe(false);
    expect(at(26, 0)).toBe(false);
    expect(at(26, 1)).toBe(true);
  });
});

describe('deriveCapabilities — metadata + sections', () => {
  it('carries fw, wire, platformId and display labels through for display / escape-hatch use', () => {
    const c = deriveCapabilities({ fw: fw(1, 1, 3), wireVersion: 6, payloadLength: 2896, platformId: 1 });
    expect(c.fw).toEqual(fw(1, 1, 3));
    expect(c.fwLabel).toBe('1.1.3');
    expect(c.wire).toBe(6);
    expect(c.wireLabel).toBe('V6');
    expect(c.platformId).toBe(1);
  });

  it('formats labels from the V10 branch correctly', () => {
    const c = deriveCapabilities({ fw: fw(1, 1, 4), wireVersion: 10, payloadLength: 2960, platformId: 1 });
    expect(c.fwLabel).toBe('1.1.4');
    expect(c.wireLabel).toBe('V10');
  });

  it('derives bulk sections from the observed header by delegating to bulkLayout', () => {
    const header = { formatVersion: 6, payloadLength: 2896 };
    const c = deriveCapabilities({ fw: fw(1, 1, 3), wireVersion: 6, payloadLength: 2896, platformId: 1 });
    expect(c.sections).toEqual(Wire.bulkLayout(header));
  });

  it('reflects a packet truncated below the masterVolume tail as lacking that section', () => {
    const c = deriveCapabilities({
      fw: fw(1, 1, 3), wireVersion: 6, payloadLength: Wire.BulkSizes.V6Preamp, platformId: 1,
    });
    expect(c.sections.preamp).toBe(true);
    expect(c.sections.masterVolume).toBe(false);
  });
});
