import { describe, it, expect, beforeEach } from 'vitest';
import { presets, presetsDirty, resetPresets, askBoundary, resolveBoundary } from './presets.svelte';
import { mirror } from './mirror.svelte';
import { settings } from './settings.svelte';
import type { DspSnapshot } from '@/domain';

function mkSnap(overrides: Partial<DspSnapshot> = {}): DspSnapshot {
  return {
    platform: { name: 'rp2350', type: 'rp2350', totalChannelCount: 11, outputCount: 4 } as any,
    bypass: false,
    masterPreampDb: 0,
    inputPreampDb: [0, 0],
    masterVolumeDb: 0,
    channels: [], outputs: [], routes: [],
    loudness: { enabled: false, refSpl: 85, intensityPct: 0 },
    crossfeed: { enabled: false, preset: 0, itd: false, freq: 700, feedDb: 4.5 } as any,
    leveller: { enabled: false, speed: 1, lookahead: false, amount: 0, maxGainDb: 0, gateDb: -40 } as any,
    i2s: { outputSlotTypes: [0, 0, 0, 0], bckPin: 14, mckPin: 13, mckEnabled: false, mckMultiplierEncoded: 0 } as any,
    outputPins: [],
    inputConfig: null, lgSoundSync: null, userVolume: null, dacHwMute: null,
    ...overrides,
  };
}

// Seed current + baseline from a hand-built snapshot. These tests exercise
// presetsDirty (current vs baseline) with synthetic fixtures that have no
// backing wire packet. mirror.init sets current and deep-copies into baseline,
// which matches the intent here (both cells equal after seeding).
function seed(snap: DspSnapshot): void {
  mirror.init(snap);
}

describe('presets store', () => {
  beforeEach(() => {
    resetPresets();
    mirror.reset();
    settings.soft.muted = false;
    settings.soft.mutedFromDb = null;
  });

  it('initial state has null directory and empty names', () => {
    expect(presets.directory).toBe(null);
    expect(presets.active).toBe(null);
    expect(presets.busy).toBe(false);
    expect(presets.names).toEqual(Array(10).fill(null));
  });

  it('presetsDirty is false when baseline is null', () => {
    expect(presetsDirty.current).toBe(false);
  });

  it('presetsDirty is false when current === baseline', () => {
    seed(mkSnap());
    expect(presetsDirty.current).toBe(false);
  });

  it('presetsDirty flips true when current deviates from baseline', () => {
    seed(mkSnap({ bypass: false }));
    expect(presetsDirty.current).toBe(false);
    if (mirror.current) mirror.current.bypass = true;
    expect(presetsDirty.current).toBe(true);
  });

  it('presetsDirty ignores masterVolumeDb in Mode 0 (no directory cached)', () => {
    seed(mkSnap({ masterVolumeDb: 0 }));
    if (mirror.current) mirror.current.masterVolumeDb = -12;
    // directory is null → mode-0 default → volume excluded from diff
    expect(presetsDirty.current).toBe(false);
  });

  it('presetsDirty includes masterVolumeDb in Mode 1', () => {
    seed(mkSnap({ masterVolumeDb: 0 }));
    presets.directory = {
      occupiedSlotsSet: new Set(),
      startupMode: 0, defaultSlot: 0 as any, lastActiveSlot: null,
      includePins: false,
      masterVolumeMode: 1 as any,
    };
    if (mirror.current) mirror.current.masterVolumeDb = -12;
    expect(presetsDirty.current).toBe(true);
  });

  it('presetsDirty skips volume when softMuted', () => {
    seed(mkSnap({ masterVolumeDb: 0 }));
    presets.directory = {
      occupiedSlotsSet: new Set(),
      startupMode: 0, defaultSlot: 0 as any, lastActiveSlot: null,
      includePins: false,
      masterVolumeMode: 1 as any,
    };
    settings.soft.muted = true;
    if (mirror.current) mirror.current.masterVolumeDb = -128;
    expect(presetsDirty.current).toBe(false);
  });

  it('presetsDirty flips true on a per-band bypass change (SP1 gap closed)', () => {
    const withBand = (bypass: boolean): DspSnapshot => mkSnap({
      channels: [{
        id: 0 as any, name: 'ch0', defaultName: 'ch0', shortName: 'c0',
        bandCount: 1, isOutput: false, outputMode: null,
        filters: [{ type: 0, bypass, frequency: 1000, q: 1, gain: 0 }],
      }],
    });
    seed(withBand(false));
    expect(presetsDirty.current).toBe(false);
    if (mirror.current) mirror.current.channels[0].filters[0].bypass = true;
    expect(presetsDirty.current).toBe(true);
  });

  it('presetsDirty ignores a device-reported lgSoundSync status change', () => {
    seed(mkSnap({ lgSoundSync: { enabled: true, present: false, volume: 0, muted: false } as any }));
    expect(presetsDirty.current).toBe(false);
    if (mirror.current?.lgSoundSync) {
      mirror.current.lgSoundSync.present = true;
      mirror.current.lgSoundSync.volume = 42;
    }
    expect(presetsDirty.current).toBe(false);
  });

  it('presetsDirty flips true on an lgSoundSync.enabled change', () => {
    seed(mkSnap({ lgSoundSync: { enabled: false, present: false, volume: 0, muted: false } as any }));
    expect(presetsDirty.current).toBe(false);
    if (mirror.current?.lgSoundSync) mirror.current.lgSoundSync.enabled = true;
    expect(presetsDirty.current).toBe(true);
  });

  it('presetsDirty flips true on a userVolume change', () => {
    seed(mkSnap({ userVolume: { volumeDb: 0, mute: false } as any }));
    expect(presetsDirty.current).toBe(false);
    if (mirror.current?.userVolume) mirror.current.userVolume.volumeDb = -6;
    expect(presetsDirty.current).toBe(true);
  });

  it('presetsDirty flips true on an i2s config change', () => {
    seed(mkSnap({ i2s: { outputSlotTypes: [0, 0, 0, 0], bckPin: 14, mckPin: 13, mckEnabled: false, mckMultiplierEncoded: 0 } as any }));
    expect(presetsDirty.current).toBe(false);
    if (mirror.current?.i2s) mirror.current.i2s.bckPin = 20;
    expect(presetsDirty.current).toBe(true);
  });

  it('presetsDirty counts an outputPins change only when includePins is true', () => {
    const dir = (includePins: boolean) => ({
      occupiedSlotsSet: new Set<number>(),
      startupMode: 0, defaultSlot: 0 as any, lastActiveSlot: null,
      includePins, masterVolumeMode: 0 as any,
    });
    seed(mkSnap({ outputPins: [6, 7] }));
    if (mirror.current) mirror.current.outputPins[1] = 8;
    // includePins=false → pins are not part of the preset → not dirty
    presets.directory = dir(false) as any;
    expect(presetsDirty.current).toBe(false);
    // includePins=true → pins ride the preset → dirty
    presets.directory = dir(true) as any;
    expect(presetsDirty.current).toBe(true);
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
