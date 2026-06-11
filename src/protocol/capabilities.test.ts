import { describe, it, expect } from 'vitest';
import { deriveCapabilities, MAX_KNOWN_WIRE } from './capabilities';
import { Wire } from '@/protocol';

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
