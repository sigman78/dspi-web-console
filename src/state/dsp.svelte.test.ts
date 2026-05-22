import { describe, it, expect, beforeEach } from 'vitest';
import { parseBulkParams } from '@/protocol';
import { makeBulk } from '@test/fixtures/bulkFixtures';
import { PlatformType, createHardwareProfile } from '@/domain';
import { dsp, applyBulkBaseline, applyBulkLive, resetDsp } from './dsp.svelte';

const hw = createHardwareProfile(PlatformType.RP2350);

describe('dsp state: wireBase', () => {
  beforeEach(() => {
    resetDsp();
    dsp.shadow = null;
    dsp.wireBase = null;
  });

  it('applyBulkBaseline populates live, shadow, and wireBase', () => {
    const bulk = parseBulkParams(makeBulk());
    applyBulkBaseline(hw, bulk);
    expect(dsp.live).not.toBeNull();
    expect(dsp.shadow).not.toBeNull();
    expect(dsp.wireBase).toBe(bulk);
  });
});

describe('applyBulkLive', () => {
  it('refreshes live and wireBase but leaves shadow pinned', () => {
    const base = parseBulkParams(makeBulk({ masterVolumeDb: -10 }));
    applyBulkBaseline(hw, base);            // live = shadow = wireBase
    const shadowBefore = dsp.shadow;

    const next = parseBulkParams(makeBulk({ masterVolumeDb: -20 }));
    applyBulkLive(hw, next);

    expect(dsp.live?.masterVolumeDb).toBe(-20);  // live advanced
    expect(dsp.wireBase).toBe(next);             // wireBase advanced to the fetched packet
    expect(dsp.shadow).toBe(shadowBefore);       // shadow pinned (same reference)
    expect(dsp.shadow?.masterVolumeDb).toBe(-10);
  });
});
