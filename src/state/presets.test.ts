import { describe, it, expect, beforeEach } from 'vitest';
import { presetsDirty, resetBoundary, askBoundary, resolveBoundary } from './presets.svelte';
import { activeSession, dispatch } from './appState.svelte';
import { makeReadySession } from './makeSession.svelte';
import { settings } from './settings.svelte';
import { OutputConfigMode, type DspSnapshot } from '@/domain';

const liveMirror = () => activeSession()!.mirror;
const ps = () => activeSession()!.presets;
const dirty = () => presetsDirty(activeSession()!);

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
// backing wire packet. init sets current and deep-copies into baseline,
// which matches the intent here (both cells equal after seeding).
function seed(snap: DspSnapshot): void {
  liveMirror().init(snap);
}

describe('presets store', () => {
  beforeEach(() => {
    dispatch({ t: 'disconnected' });
    dispatch({ t: 'synced', session: makeReadySession({ info: {}, hardware: {} } as never) });
    resetBoundary();
    settings.soft.muted = false;
    settings.soft.mutedFromDb = null;
  });

  it('initial state has null directory and empty names', () => {
    expect(ps().directory).toBe(null);
    expect(ps().active).toBe(null);
    expect(ps().busy).toBe(false);
    expect(ps().names).toEqual(Array(10).fill(null));
  });

  it('presetsDirty is false when baseline is null', () => {
    expect(dirty()).toBe(false);
  });

  it('presetsDirty is false when current === baseline', () => {
    seed(mkSnap());
    expect(dirty()).toBe(false);
  });

  it('presetsDirty flips true when current deviates from baseline', () => {
    seed(mkSnap({ bypass: false }));
    expect(dirty()).toBe(false);
    liveMirror().snapshot.bypass = true;
    expect(dirty()).toBe(true);
  });

  it('presetsDirty ignores masterVolumeDb in Mode 0 (no directory cached)', () => {
    seed(mkSnap({ masterVolumeDb: 0 }));
    liveMirror().snapshot.masterVolumeDb = -12;
    // directory is null → mode-0 default → volume excluded from diff
    expect(dirty()).toBe(false);
  });

  it('presetsDirty includes masterVolumeDb in Mode 1', () => {
    seed(mkSnap({ masterVolumeDb: 0 }));
    ps().directory = {
      occupiedSlotsSet: new Set(),
      startupMode: 0, defaultSlot: 0 as any, lastActiveSlot: null,
      outputConfigMode: OutputConfigMode.Independent,
      masterVolumeMode: 1 as any,
    };
    liveMirror().snapshot.masterVolumeDb = -12;
    expect(dirty()).toBe(true);
  });

  it('presetsDirty skips volume when softMuted', () => {
    seed(mkSnap({ masterVolumeDb: 0 }));
    ps().directory = {
      occupiedSlotsSet: new Set(),
      startupMode: 0, defaultSlot: 0 as any, lastActiveSlot: null,
      outputConfigMode: OutputConfigMode.Independent,
      masterVolumeMode: 1 as any,
    };
    settings.soft.muted = true;
    liveMirror().snapshot.masterVolumeDb = -128;
    expect(dirty()).toBe(false);
  });

  it('presetsDirty flips true on a per-band bypass change (SP1 gap closed)', () => {
    const withBand = (bypass: boolean): DspSnapshot => mkSnap({
      channels: [{
        id: 0 as any, name: 'ch0', defaultName: 'ch0', shortName: 'c0',
        bandCount: 1, isOutput: false,
        filters: [{ type: 0, bypass, frequency: 1000, q: 1, gain: 0 }],
      }],
    });
    seed(withBand(false));
    expect(dirty()).toBe(false);
    liveMirror().snapshot.channels[0].filters[0].bypass = true;
    expect(dirty()).toBe(true);
  });

  it('presetsDirty ignores a device-reported lgSoundSync status change', () => {
    seed(mkSnap({ lgSoundSync: { enabled: true, present: false, volume: 0, muted: false } as any }));
    expect(dirty()).toBe(false);
    const lg = liveMirror().snapshot.lgSoundSync;
    if (lg) {
      lg.present = true;
      lg.volume = 42;
    }
    expect(dirty()).toBe(false);
  });

  it('presetsDirty flips true on an lgSoundSync.enabled change', () => {
    seed(mkSnap({ lgSoundSync: { enabled: false, present: false, volume: 0, muted: false } as any }));
    expect(dirty()).toBe(false);
    const lg = liveMirror().snapshot.lgSoundSync;
    if (lg) lg.enabled = true;
    expect(dirty()).toBe(true);
  });

  it('presetsDirty flips true on a userVolume change', () => {
    seed(mkSnap({ userVolume: { volumeDb: 0, mute: false } as any }));
    expect(dirty()).toBe(false);
    const uv = liveMirror().snapshot.userVolume;
    if (uv) uv.volumeDb = -6;
    expect(dirty()).toBe(true);
  });

  it('presetsDirty stays false on an i2s change while the directory (mode) is unknown', () => {
    seed(mkSnap({ i2s: { outputSlotTypes: [0, 0, 0, 0], bckPin: 14, mckPin: 13, mckEnabled: false, mckMultiplierEncoded: 0 } as any }));
    const i2s = liveMirror().snapshot.i2s;
    if (i2s) i2s.bckPin = 20;
    expect(dirty()).toBe(false);
  });

  it('presetsDirty counts an outputPins change only in WithPreset mode', () => {
    const dir = (mode: OutputConfigMode) => ({
      occupiedSlotsSet: new Set<number>(),
      startupMode: 0, defaultSlot: 0 as any, lastActiveSlot: null,
      outputConfigMode: mode, masterVolumeMode: 0 as any,
    });
    seed(mkSnap({ outputPins: [6, 7] }));
    liveMirror().snapshot.outputPins[1] = 8;
    // Independent → pins are not part of the preset → not dirty
    ps().directory = dir(OutputConfigMode.Independent) as any;
    expect(dirty()).toBe(false);
    // WithPreset → pins ride the preset → dirty
    ps().directory = dir(OutputConfigMode.WithPreset) as any;
    expect(dirty()).toBe(true);
  });

  const dirWithMode = (outputConfigMode: OutputConfigMode) => ({
    occupiedSlotsSet: new Set<number>(),
    startupMode: 0, defaultSlot: 0 as any, lastActiveSlot: null,
    outputConfigMode, masterVolumeMode: 0 as any,
  });

  it('masks an i2s change by output-config mode', () => {
    seed(mkSnap());
    liveMirror().snapshot.i2s.bckPin = 20;
    ps().directory = dirWithMode(OutputConfigMode.Independent) as any;
    expect(dirty()).toBe(false);
    ps().directory = dirWithMode(OutputConfigMode.WithPreset) as any;
    expect(dirty()).toBe(true);
  });

  it('masks a spdifRxPin change by output-config mode', () => {
    seed(mkSnap({ inputConfig: { source: 0, spdifRxPin: 5 } as any }));
    liveMirror().snapshot.inputConfig!.spdifRxPin = 7;
    ps().directory = dirWithMode(OutputConfigMode.Independent) as any;
    expect(dirty()).toBe(false);
    ps().directory = dirWithMode(OutputConfigMode.WithPreset) as any;
    expect(dirty()).toBe(true);
  });

  it('a freshly installed session starts with cleared preset fields', () => {
    // Dirty the current session's preset fields.
    ps().directory = {
      occupiedSlotsSet: new Set(),
      startupMode: 0, defaultSlot: 0 as any, lastActiveSlot: null,
      outputConfigMode: OutputConfigMode.Independent,
      masterVolumeMode: 0 as any,
    };
    ps().active = 3 as any;
    ps().names = Array.from({ length: 10 }, (_, i) => `n${i}`);
    ps().busy = true;
    ps().lastFetchError = 'something';
    ps().lastActionError = 'oops';
    // Reinstalling a session gives a fresh PresetsState — the explicit
    // field-reset is now this per-session freshness invariant.
    dispatch({ t: 'disconnected' });
    dispatch({ t: 'synced', session: makeReadySession({ info: {}, hardware: {} } as never) });
    expect(ps().directory).toBe(null);
    expect(ps().active).toBe(null);
    expect(ps().names).toEqual(Array(10).fill(null));
    expect(ps().busy).toBe(false);
    expect(ps().lastFetchError).toBe(null);
    expect(ps().lastActionError).toBe(null);
  });
});

describe('boundary modal', () => {
  beforeEach(() => resetBoundary());

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
