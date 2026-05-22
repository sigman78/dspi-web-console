import { describe, it, expect, beforeEach } from 'vitest';
import { parseBulkParams } from '@/protocol';
import { makeBulk } from '@test/fixtures/bulkFixtures';
import { PlatformType, createHardwareProfile } from '@/domain';
import { dsp, applyBulkBaseline, applyBulkLive, resetDsp } from './dsp.svelte';

const hw = createHardwareProfile(PlatformType.RP2350);

describe('dsp state: wireBase + flush', () => {
  beforeEach(() => {
    resetDsp();
    dsp.shadow = null;
    dsp.wireBase = null;
    dsp.flush.inflight = null;
    dsp.flush.currentRev = 0;
    dsp.flush.lastSentRev = 0;
  });

  it('applyBulkBaseline populates live, shadow, and wireBase', () => {
    const bulk = parseBulkParams(makeBulk());
    applyBulkBaseline(hw, bulk);
    expect(dsp.live).not.toBeNull();
    expect(dsp.shadow).not.toBeNull();
    expect(dsp.wireBase).toBe(bulk);
  });

  it('applyBulkBaseline resets the flush revision counters', () => {
    dsp.flush.currentRev = 7;
    dsp.flush.lastSentRev = 3;
    const bulk = parseBulkParams(makeBulk());
    applyBulkBaseline(hw, bulk);
    expect(dsp.flush.currentRev).toBe(0);
    expect(dsp.flush.lastSentRev).toBe(0);
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
