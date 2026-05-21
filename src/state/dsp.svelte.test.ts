import { describe, it, expect, beforeEach } from 'vitest';
import { parseBulkParams } from '@/protocol';
import { makeBulk } from '@test/fixtures/bulkFixtures';
import { PlatformType, fromBulkParams, createHardwareProfile } from '@/domain';
import { dsp, applyDspSnapshot, resetDsp } from './dsp.svelte';

const hw = createHardwareProfile(PlatformType.RP2350);

describe('dsp state: baselineBulk + flush', () => {
  beforeEach(() => {
    resetDsp();
    dsp.shadow = null;
    dsp.baselineBulk = null;
    dsp.flush.inflight = null;
    dsp.flush.currentRev = 0;
    dsp.flush.lastSentRev = 0;
  });

  it('applyDspSnapshot with bulk populates live, shadow, and baselineBulk', () => {
    const bulk = parseBulkParams(makeBulk());
    const snap = fromBulkParams(hw, bulk);
    applyDspSnapshot(snap, bulk);
    expect(dsp.live).not.toBeNull();
    expect(dsp.shadow).not.toBeNull();
    expect(dsp.baselineBulk).toBe(bulk);
  });

  it('applyDspSnapshot with bulk resets the flush revision counters', () => {
    dsp.flush.currentRev = 7;
    dsp.flush.lastSentRev = 3;
    const bulk = parseBulkParams(makeBulk());
    applyDspSnapshot(fromBulkParams(hw, bulk), bulk);
    expect(dsp.flush.currentRev).toBe(0);
    expect(dsp.flush.lastSentRev).toBe(0);
  });

  it('applyDspSnapshot without bulk leaves baselineBulk untouched', () => {
    const bulk = parseBulkParams(makeBulk());
    dsp.baselineBulk = bulk;
    applyDspSnapshot(fromBulkParams(hw, bulk));
    expect(dsp.baselineBulk).toBe(bulk);
  });
});
