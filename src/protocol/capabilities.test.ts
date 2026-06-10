import { describe, it, expect } from 'vitest';
import { deriveCapabilities, acceptsWriteFormat, MIN_SUPPORTED_WIRE, MAX_KNOWN_WIRE, NOTIFY_MIN_WIRE } from './capabilities';
import { Wire } from '@/protocol';

const fw = (major: number, minor: number, patch: number) => ({ major, minor, patch });

describe('deriveCapabilities — support classification', () => {
  it('rejects firmware below the V6 floor as unsupported', () => {
    const c = deriveCapabilities({ fw: fw(1, 1, 2), wireVersion: 5, payloadLength: 2864, platformId: 1 });
    expect(c.support).toBe('unsupported');
  });

  it('classifies the V6 stable (1.1.3) as supported', () => {
    const c = deriveCapabilities({ fw: fw(1, 1, 3), wireVersion: 6, payloadLength: 2896, platformId: 1 });
    expect(c.support).toBe('supported');
  });

  it('classifies the V10 dev branch (1.1.4) as supported', () => {
    const c = deriveCapabilities({ fw: fw(1, 1, 4), wireVersion: 10, payloadLength: 2960, platformId: 1 });
    expect(c.support).toBe('supported');
  });

  it('classifies a wire version beyond MAX_KNOWN_WIRE as future', () => {
    const c = deriveCapabilities({ fw: fw(1, 2, 0), wireVersion: MAX_KNOWN_WIRE + 1, payloadLength: 3024, platformId: 1 });
    expect(c.support).toBe('future');
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

describe('deriveCapabilities — features', () => {
  it('enables notifications only on wire >= NOTIFY_MIN_WIRE', () => {
    const below = deriveCapabilities({ fw: fw(1, 1, 3), wireVersion: NOTIFY_MIN_WIRE - 1, payloadLength: 2896, platformId: 1 });
    const at    = deriveCapabilities({ fw: fw(1, 1, 4), wireVersion: NOTIFY_MIN_WIRE,     payloadLength: 2912, platformId: 1 });
    const above = deriveCapabilities({ fw: fw(1, 1, 4), wireVersion: NOTIFY_MIN_WIRE + 1, payloadLength: 2928, platformId: 1 });
    expect(below.features.notifications).toBe(false);
    expect(at.features.notifications).toBe(true);
    expect(above.features.notifications).toBe(true);
  });
});

describe('deriveCapabilities — 1.1.4 features', () => {
  const v6 = deriveCapabilities({ fw: { major: 1, minor: 1, patch: 3 }, wireVersion: 6, payloadLength: 2896, platformId: 1 });
  const v10 = deriveCapabilities({ fw: { major: 1, minor: 1, patch: 4 }, wireVersion: 10, payloadLength: 2960, platformId: 1 });

  it('a 1.1.3 (V6) device exposes none of the new features', () => {
    expect(v6.features.inputSourceSwitch).toBe(false);
    expect(v6.features.bandBypass).toBe(false);
    expect(v6.features.notchFilter).toBe(false);
    expect(v6.features.dacHwMute).toBe(false);
    expect(v6.features.outputConfigSave).toBe(false);
    expect(v6.sections.inputSource).toBe(false);
  });

  it('a 1.1.4 (V10) device exposes the full new surface', () => {
    expect(v10.features.inputSourceSwitch).toBe(true);
    expect(v10.features.spdifRx).toBe(true);
    expect(v10.features.lgSoundSync).toBe(true);
    expect(v10.features.userVolumeAxis).toBe(true);
    expect(v10.features.dacHwMute).toBe(true);
    expect(v10.features.bandBypass).toBe(true);
    expect(v10.features.notchFilter).toBe(true);
    expect(v10.features.allpassFilter).toBe(true);
    expect(v10.features.outputConfigSave).toBe(true);
    expect(v10.sections.dacHwMute).toBe(true);
  });

  it('section thresholds track wire version (V8 device: LG yes, user-volume no)', () => {
    const v8 = deriveCapabilities({ fw: { major: 1, minor: 1, patch: 4 }, wireVersion: 8, payloadLength: 2928, platformId: 1 });
    expect(v8.features.lgSoundSync).toBe(true);
    expect(v8.features.userVolumeAxis).toBe(false);
    expect(v8.features.dacHwMute).toBe(false);
  });
});

describe('acceptsWriteFormat — firmware-merge write rule', () => {
  const caps = (wire: number) =>
    deriveCapabilities({ fw: fw(1, 1, 3), wireVersion: wire, payloadLength: 2896, platformId: 1 });

  it('accepts an equal-version blob (the common same-session case)', () => {
    expect(acceptsWriteFormat(caps(6), 6)).toBe(true);
  });

  it('accepts a lower-version blob onto a higher device (merges up)', () => {
    expect(acceptsWriteFormat(caps(10), 6)).toBe(true);
  });

  it('rejects a higher-version blob the firmware would refuse', () => {
    expect(acceptsWriteFormat(caps(6), 10)).toBe(false);
  });

  it('rejects a blob below the V6 floor regardless of device', () => {
    expect(acceptsWriteFormat(caps(10), MIN_SUPPORTED_WIRE - 1)).toBe(false);
  });

  it('still accepts known-format blobs on a future (too-new) device — option C', () => {
    const future = caps(MAX_KNOWN_WIRE + 1);
    expect(acceptsWriteFormat(future, 6)).toBe(true);
    expect(acceptsWriteFormat(future, MAX_KNOWN_WIRE)).toBe(true);
  });
});
