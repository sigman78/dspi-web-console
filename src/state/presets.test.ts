import { describe, it, expect, beforeEach } from 'vitest';
import { presets, presetsDirty, resetPresets, askBoundary, resolveBoundary } from './presets.svelte';
import { applyDspSnapshot, dsp } from './dsp.svelte';
import { settings } from './settings.svelte';
import type { DspSnapshot } from '../domain/snapshot';

function mkSnap(overrides: Partial<DspSnapshot> = {}): DspSnapshot {
  return {
    platform: { name: 'rp2350', type: 'rp2350', totalChannelCount: 11, outputCount: 4 } as any,
    formatVersion: 6,
    bypass: false,
    masterPreampDb: 0,
    inputPreampDb: [0, 0],
    masterVolumeDb: 0,
    channels: [], outputs: [], routes: [],
    loudness: { enabled: false, refSpl: 85, intensityPct: 0 },
    crossfeed: { enabled: false, preset: 0, itd: false, freq: 700, feedDb: 4.5 } as any,
    leveller: null, i2s: null,
    ...overrides,
  };
}

describe('presets store', () => {
  beforeEach(() => {
    resetPresets();
    dsp.live = null;
    dsp.shadow = null;
    settings.soft.muted = false;
    settings.soft.mutedFromDb = null;
  });

  it('initial state has null directory and empty names', () => {
    expect(presets.directory).toBe(null);
    expect(presets.active).toBe(null);
    expect(presets.busy).toBe(false);
    expect(presets.names).toEqual(Array(10).fill(null));
  });

  it('presetsDirty is false when shadow is null', () => {
    expect(presetsDirty.current).toBe(false);
  });

  it('presetsDirty is false when live === shadow', () => {
    applyDspSnapshot(mkSnap());
    expect(presetsDirty.current).toBe(false);
  });

  it('presetsDirty flips true when live deviates from shadow', () => {
    applyDspSnapshot(mkSnap({ bypass: false }));
    expect(presetsDirty.current).toBe(false);
    if (dsp.live) dsp.live.bypass = true;
    expect(presetsDirty.current).toBe(true);
  });

  it('presetsDirty ignores masterVolumeDb in Mode 0 (no directory cached)', () => {
    applyDspSnapshot(mkSnap({ masterVolumeDb: 0 }));
    if (dsp.live) dsp.live.masterVolumeDb = -12;
    // directory is null → mode-0 default → volume excluded from diff
    expect(presetsDirty.current).toBe(false);
  });

  it('presetsDirty includes masterVolumeDb in Mode 1', () => {
    applyDspSnapshot(mkSnap({ masterVolumeDb: 0 }));
    presets.directory = {
      occupiedSlotsSet: new Set(),
      startupMode: 0, defaultSlot: 0 as any, lastActiveSlot: null,
      includePins: false,
      masterVolumeMode: 1 as any,
    };
    if (dsp.live) dsp.live.masterVolumeDb = -12;
    expect(presetsDirty.current).toBe(true);
  });

  it('presetsDirty skips volume when softMuted', () => {
    applyDspSnapshot(mkSnap({ masterVolumeDb: 0 }));
    presets.directory = {
      occupiedSlotsSet: new Set(),
      startupMode: 0, defaultSlot: 0 as any, lastActiveSlot: null,
      includePins: false,
      masterVolumeMode: 1 as any,
    };
    settings.soft.muted = true;
    if (dsp.live) dsp.live.masterVolumeDb = -128;
    expect(presetsDirty.current).toBe(false);
  });

  it('resetPresets clears all fields', () => {
    presets.directory = {
      occupiedSlotsSet: new Set(),
      startupMode: 0, defaultSlot: 0 as any, lastActiveSlot: null,
      includePins: false,
      masterVolumeMode: 0 as any,
    };
    presets.active = 3 as any;
    presets.names = Array.from({ length: 10 }, (_, i) => `n${i}`);
    presets.busy = true;
    presets.lastFetchError = 'something';
    presets.lastActionError = 'oops';
    resetPresets();
    expect(presets.directory).toBe(null);
    expect(presets.active).toBe(null);
    expect(presets.names).toEqual(Array(10).fill(null));
    expect(presets.busy).toBe(false);
    expect(presets.lastFetchError).toBe(null);
    expect(presets.lastActionError).toBe(null);
  });
});

describe('boundary modal', () => {
  beforeEach(() => resetPresets());

  it('resolves with the chosen choice', async () => {
    const p = askBoundary({
      title: 'Test',
      message: 'msg',
      saveLabel: 'Save and continue',
    });
    resolveBoundary('save');
    const r = await p;
    expect(r).toBe('save');
  });

  it('only one pending modal at a time (second call rejects)', async () => {
    const p1 = askBoundary({ title: 't1', message: 'm', saveLabel: 's' });
    const p2 = askBoundary({ title: 't2', message: 'm', saveLabel: 's' });
    resolveBoundary('cancel');
    expect(await p1).toBe('cancel');
    await expect(p2).rejects.toThrow();
  });
});
