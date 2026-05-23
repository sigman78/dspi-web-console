import { describe, test, expect, beforeEach } from 'vitest';
import { SvelteSet } from 'svelte/reactivity';
import { parseBulkParams } from '@/protocol';
import { fromBulkParams } from '@/device/snapshotCodec';
import { makeBulk } from '@test/fixtures/bulkFixtures';
import { PlatformType, createHardwareProfile } from '@/domain';
import { dsp, applyBaselineSnapshot, patchSnapshot, resetDsp, refreshShadowFromLive, isInFlight } from './dsp.svelte';

const hw = createHardwareProfile(PlatformType.RP2350);

function seedBaseline(masterVolumeDb = -6): void {
  applyBaselineSnapshot(fromBulkParams(hw, parseBulkParams(makeBulk({ masterVolumeDb }))));
}

describe('dsp store: live / shadow lifecycle', () => {
  beforeEach(() => {
    dsp.live = null;
    dsp.shadow = null;
    dsp.pendingWrites = new SvelteSet();
  });

  test('applyBaselineSnapshot populates shadow as a deep copy of live', () => {
    seedBaseline(-6);
    expect(dsp.live).not.toBeNull();
    expect(dsp.shadow).not.toBeNull();
    expect(dsp.shadow).toEqual(dsp.live);
    expect(dsp.shadow).not.toBe(dsp.live);
  });

  test('resetDsp clears live but preserves shadow', () => {
    seedBaseline(-6);
    const shadowBefore = dsp.shadow;
    resetDsp();
    expect(dsp.live).toBeNull();
    expect(dsp.shadow).toBe(shadowBefore);
  });

  test('patchSnapshot mutates live but does not affect shadow', () => {
    seedBaseline(-6);
    const shadowVolBefore = dsp.shadow!.masterVolumeDb;
    patchSnapshot({ masterVolumeDb: -42 });
    expect(dsp.live!.masterVolumeDb).toBe(-42);
    expect(dsp.shadow!.masterVolumeDb).toBe(shadowVolBefore);
  });

  test('a second applyBaselineSnapshot replaces both live and shadow', () => {
    seedBaseline(-6);
    seedBaseline(-12);
    expect(dsp.live!.masterVolumeDb).toBe(-12);
    expect(dsp.shadow!.masterVolumeDb).toBe(-12);
  });
});

describe('dsp store: pendingWrites + isInFlight', () => {
  beforeEach(() => {
    dsp.live = null;
    dsp.shadow = null;
    dsp.pendingWrites = new SvelteSet();
  });

  test('isInFlight is true when only pendingWrites has entries', () => {
    const tok = Symbol('test');
    expect(isInFlight.current).toBe(false);
    dsp.pendingWrites.add(tok);
    expect(isInFlight.current).toBe(true);
    dsp.pendingWrites.delete(tok);
    expect(isInFlight.current).toBe(false);
  });

  test('resetDsp clears pendingWrites', () => {
    dsp.pendingWrites.add(Symbol('x'));
    resetDsp();
    expect(dsp.pendingWrites.size).toBe(0);
  });
});

describe('refreshShadowFromLive', () => {
  beforeEach(() => {
    dsp.live = null;
    dsp.shadow = null;
    dsp.pendingWrites = new SvelteSet();
  });

  test('copies live → shadow', () => {
    seedBaseline(-6);
    // Mutate live directly (simulating an optimistic patch)
    if (dsp.live) dsp.live.bypass = true;
    expect(dsp.shadow?.bypass).toBe(false);
    refreshShadowFromLive();
    expect(dsp.shadow?.bypass).toBe(true);
  });

  test('clones (does not share refs)', () => {
    seedBaseline(-6);
    refreshShadowFromLive();
    // Mutating live after refresh must not propagate to shadow
    if (dsp.live) dsp.live.bypass = true;
    expect(dsp.shadow?.bypass).toBe(false);
  });

  test('no-op when live is null', () => {
    dsp.live = null;
    dsp.shadow = null; // ensure starting state
    expect(() => refreshShadowFromLive()).not.toThrow();
    expect(dsp.shadow).toBeNull();
  });
});
