import { describe, it, expect } from 'vitest';
import { computeCapabilities } from './session.svelte';

describe('computeCapabilities', () => {
  it('enables bulk write + per-item master volume on V6+', () => {
    const caps = computeCapabilities(6);
    expect(caps.setAllParams).toBe(true);
    expect(caps.perItemMasterVolume).toBe(true);
    expect(caps.loudnessCrossfeedLeveller).toBe(true);
    expect(caps.i2sConfig).toBe(true);
  });

  it('disables bulk write below V6 but keeps V4 processing on V4/V5', () => {
    const caps = computeCapabilities(4);
    expect(caps.setAllParams).toBe(false);
    expect(caps.perItemMasterVolume).toBe(false);
    expect(caps.loudnessCrossfeedLeveller).toBe(true);
    expect(caps.i2sConfig).toBe(true);
  });

  it('disables everything optional on V0 (unknown)', () => {
    const caps = computeCapabilities(0);
    expect(caps.setAllParams).toBe(false);
    expect(caps.loudnessCrossfeedLeveller).toBe(false);
    expect(caps.i2sConfig).toBe(false);
  });
});
