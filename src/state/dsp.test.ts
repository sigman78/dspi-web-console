import { describe, test, expect, beforeEach } from 'vitest';
import { SvelteSet } from 'svelte/reactivity';
import { parseBulkParams } from '../protocol/bulkParser';
import { synthesizeBulkParams } from '../protocol/bulkParser.syn';
import { PlatformType } from '../domain/platform';
import { fromBulkParams } from '../domain/bulkToSnapshot';
import { createHardwareProfile } from '../domain/hardware';
import { dsp, applyDspSnapshot, patchSnapshot, resetDsp } from './dsp.svelte';

function makeSnapshot(masterVolumeDb = -6) {
  const bulk = parseBulkParams(synthesizeBulkParams({ formatVersion: 6, masterVolumeDb }));
  return fromBulkParams(createHardwareProfile(PlatformType.RP2350), bulk);
}

describe('dsp store: live / shadow lifecycle', () => {
  beforeEach(() => {
    dsp.live = null;
    dsp.shadow = null;
    dsp.pendingWrites = new SvelteSet();
  });

  test('applyDspSnapshot populates shadow as a deep copy of live', () => {
    const snap = makeSnapshot(-6);
    applyDspSnapshot(snap);
    expect(dsp.live).not.toBeNull();
    expect(dsp.shadow).not.toBeNull();
    expect(dsp.shadow).toEqual(dsp.live);
    expect(dsp.shadow).not.toBe(dsp.live);
  });

  test('resetDsp clears live but preserves shadow', () => {
    applyDspSnapshot(makeSnapshot(-6));
    const shadowBefore = dsp.shadow;
    resetDsp();
    expect(dsp.live).toBeNull();
    expect(dsp.shadow).toBe(shadowBefore);
  });

  test('patchSnapshot mutates live but does not affect shadow', () => {
    applyDspSnapshot(makeSnapshot(-6));
    const shadowVolBefore = dsp.shadow!.masterVolumeDb;
    patchSnapshot({ masterVolumeDb: -42 });
    expect(dsp.live!.masterVolumeDb).toBe(-42);
    expect(dsp.shadow!.masterVolumeDb).toBe(shadowVolBefore);
  });

  test('a second applyDspSnapshot replaces both live and shadow', () => {
    applyDspSnapshot(makeSnapshot(-6));
    applyDspSnapshot(makeSnapshot(-12));
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

  test('isInFlight is true when only pendingWrites has entries', async () => {
    const { isInFlight } = await import('./dsp.svelte');
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
