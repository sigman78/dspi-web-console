import { describe, test, expect, beforeEach } from 'vitest';
import { parseBulkParams } from '@/protocol';
import { fromBulkParams } from '@/device/snapshotCodec';
import { makeBulk } from '@test/fixtures/bulkFixtures';
import { PlatformType, createHardwareProfile } from '@/domain';
import { dsp, applyBaselineSnapshot, patchSnapshot, resetDsp, resetSavedBaseline, refreshSavedFromDraft, isInFlight } from './dsp.svelte';

const hw = createHardwareProfile(PlatformType.RP2350);

function seedBaseline(masterVolumeDb = -6): void {
  applyBaselineSnapshot(fromBulkParams(hw, parseBulkParams(makeBulk({ masterVolumeDb }))));
}

describe('dsp store: draft / saved lifecycle', () => {
  beforeEach(() => {
    resetDsp();
    resetSavedBaseline();
  });

  test('applyBaselineSnapshot populates saved as a deep copy of draft', () => {
    seedBaseline(-6);
    expect(dsp.draft).not.toBeNull();
    expect(dsp.saved).not.toBeNull();
    expect(dsp.saved).toEqual(dsp.draft);
    expect(dsp.saved).not.toBe(dsp.draft);
  });

  test('resetDsp clears draft but preserves saved', () => {
    seedBaseline(-6);
    const shadowBefore = dsp.saved;
    resetDsp();
    expect(dsp.draft).toBeNull();
    expect(dsp.saved).toBe(shadowBefore);
  });

  test('patchSnapshot mutates draft but does not affect saved', () => {
    seedBaseline(-6);
    const shadowVolBefore = dsp.saved!.masterVolumeDb;
    patchSnapshot({ masterVolumeDb: -42 });
    expect(dsp.draft!.masterVolumeDb).toBe(-42);
    expect(dsp.saved!.masterVolumeDb).toBe(shadowVolBefore);
  });

  test('a second applyBaselineSnapshot replaces both draft and saved', () => {
    seedBaseline(-6);
    seedBaseline(-12);
    expect(dsp.draft!.masterVolumeDb).toBe(-12);
    expect(dsp.saved!.masterVolumeDb).toBe(-12);
  });
});

describe('dsp store: pendingWrites + isInFlight', () => {
  beforeEach(() => {
    resetDsp();
    resetSavedBaseline();
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

describe('refreshSavedFromDraft', () => {
  beforeEach(() => {
    resetDsp();
    resetSavedBaseline();
  });

  test('copies draft → saved', () => {
    seedBaseline(-6);
    // Mutate draft directly (simulating an optimistic patch)
    if (dsp.draft) dsp.draft.bypass = true;
    expect(dsp.saved?.bypass).toBe(false);
    refreshSavedFromDraft();
    expect(dsp.saved?.bypass).toBe(true);
  });

  test('clones (does not share refs)', () => {
    seedBaseline(-6);
    refreshSavedFromDraft();
    // Mutating draft after refresh must not propagate to saved
    if (dsp.draft) dsp.draft.bypass = true;
    expect(dsp.saved?.bypass).toBe(false);
  });

  test('no-op when draft is null', () => {
    resetDsp();
    resetSavedBaseline(); // ensure starting state (draft + saved null)
    expect(() => refreshSavedFromDraft()).not.toThrow();
    expect(dsp.saved).toBeNull();
  });
});
