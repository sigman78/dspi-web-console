import { describe, it, expect, beforeEach } from 'vitest';
import { parseBulkParams } from '@/protocol';
import { fromBulkParams } from '@/device/snapshotCodec';
import { makeBulk } from '@test/fixtures/bulkFixtures';
import { PlatformType, createHardwareProfile } from '@/domain';
import { dsp, applyBaselineSnapshot, applyLiveSnapshot, resetDsp } from './dsp.svelte';

const hw = createHardwareProfile(PlatformType.RP2350);

function snap(opts?: Parameters<typeof makeBulk>[0]) {
  return fromBulkParams(hw, parseBulkParams(makeBulk(opts)));
}

describe('dsp state: baseline', () => {
  beforeEach(() => {
    resetDsp();
    dsp.shadow = null;
  });

  it('applyBaselineSnapshot populates live and shadow', () => {
    const s = snap();
    applyBaselineSnapshot(s);
    expect(dsp.live).not.toBeNull();
    expect(dsp.shadow).not.toBeNull();
    // shadow is a deep copy, not the same reference
    expect(dsp.shadow).toEqual(dsp.live);
    expect(dsp.shadow).not.toBe(dsp.live);
  });
});

describe('applyLiveSnapshot', () => {
  it('refreshes live but leaves shadow pinned', () => {
    applyBaselineSnapshot(snap({ masterVolumeDb: -10 }));   // live = shadow
    const shadowBefore = dsp.shadow;

    applyLiveSnapshot(snap({ masterVolumeDb: -20 }));

    expect(dsp.live?.masterVolumeDb).toBe(-20);  // live advanced
    expect(dsp.shadow).toBe(shadowBefore);       // shadow pinned (same reference)
    expect(dsp.shadow?.masterVolumeDb).toBe(-10);
  });
});
