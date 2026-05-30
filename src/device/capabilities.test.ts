import { describe, it, expect } from 'vitest';
import { deriveCapabilities, MAX_KNOWN_WIRE, NOTIFY_MIN_WIRE } from './capabilities';
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
  it('carries fw, wire and platformId through for display / escape-hatch use', () => {
    const c = deriveCapabilities({ fw: fw(1, 1, 3), wireVersion: 6, payloadLength: 2896, platformId: 1 });
    expect(c.fw).toEqual(fw(1, 1, 3));
    expect(c.wire).toBe(6);
    expect(c.platformId).toBe(1);
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
