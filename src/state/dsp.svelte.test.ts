import { describe, it, expect, beforeEach } from 'vitest';
import { parseBulkParams } from '@/protocol';
import { fromBulkParams } from '@/device/snapshotCodec';
import { makeBulk } from '@test/fixtures/bulkFixtures';
import { PlatformType, createHardwareProfile } from '@/domain';
import { dsp, applyBaselineSnapshot, applyDraftSnapshot, resetDsp } from './dsp.svelte';

const hw = createHardwareProfile(PlatformType.RP2350);

function snap(opts?: Parameters<typeof makeBulk>[0]) {
  return fromBulkParams(hw, parseBulkParams(makeBulk(opts)));
}

describe('dsp state: baseline', () => {
  beforeEach(() => {
    resetDsp();
    dsp.saved = null;
  });

  it('applyBaselineSnapshot populates draft and saved', () => {
    const s = snap();
    applyBaselineSnapshot(s);
    expect(dsp.draft).not.toBeNull();
    expect(dsp.saved).not.toBeNull();
    // saved is a deep copy, not the same reference
    expect(dsp.saved).toEqual(dsp.draft);
    expect(dsp.saved).not.toBe(dsp.draft);
  });
});

describe('applyDraftSnapshot', () => {
  it('refreshes draft but leaves saved pinned', () => {
    applyBaselineSnapshot(snap({ masterVolumeDb: -10 }));   // draft = saved
    const savedBefore = dsp.saved;

    applyDraftSnapshot(snap({ masterVolumeDb: -20 }));

    expect(dsp.draft?.masterVolumeDb).toBe(-20);  // draft advanced
    expect(dsp.saved).toBe(savedBefore);          // saved pinned (same reference)
    expect(dsp.saved?.masterVolumeDb).toBe(-10);
  });
});
