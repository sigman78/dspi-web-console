import { describe, it, expect } from 'vitest';
import { diffSnapshots, DIFF_TOLERANCE } from './snapshotDiff';
import { makeSnapshot } from '@test/fixtures/snapshotFixtures';
import type { FilterParams } from './filter';

function band(o: Partial<FilterParams> = {}): FilterParams {
  return { type: 0, bypass: false, frequency: 1000, q: 1.0, gain: 0, ...o };
}

// V10 factory: all optional sections present and non-null.
function makeV10() {
  return makeSnapshot((b) => { b.formatVersion = 10; });
}

describe('diffSnapshots — existing coverage', () => {
  it('returns [] for identical snapshots', () => {
    const a = makeSnapshot();
    const b = makeSnapshot();
    expect(diffSnapshots(a, b)).toEqual([]);
  });

  it('emits a bypass change', () => {
    const a = makeSnapshot();
    const b = structuredClone(a);
    b.bypass = true;
    expect(diffSnapshots(a, b)).toEqual([{ kind: 'bypass', value: true }]);
  });

  it('ignores sub-tolerance masterPreamp drift; emits above-tolerance', () => {
    const a = makeSnapshot();
    const bSub = structuredClone(a);
    bSub.masterPreampDb = DIFF_TOLERANCE.db * 0.5;
    expect(diffSnapshots(a, bSub)).toEqual([]);

    const bAbove = structuredClone(a);
    bAbove.masterPreampDb = DIFF_TOLERANCE.db * 2;
    expect(diffSnapshots(a, bAbove)).toEqual([{ kind: 'masterPreamp', value: DIFF_TOLERANCE.db * 2 }]);
  });

  it('treats exact-tolerance drift as no change (strict-greater boundary)', () => {
    const a = makeSnapshot();
    const b = structuredClone(a);
    b.masterPreampDb = DIFF_TOLERANCE.db;
    expect(diffSnapshots(a, b)).toEqual([]);
  });

  it('emits inputPreamp with the channel index', () => {
    const a = makeSnapshot();
    const b = structuredClone(a);
    b.inputPreampDb = [b.inputPreampDb[0], -3];
    expect(diffSnapshots(a, b)).toEqual([{ kind: 'inputPreamp', channel: 1, value: -3 }]);
  });

  it('emits masterVolume regardless of mode (gating lives in presetsDirty)', () => {
    const a = makeSnapshot();
    const b = structuredClone(a);
    b.masterVolumeDb = -6;
    expect(diffSnapshots(a, b)).toEqual([{ kind: 'masterVolume', value: -6 }]);
  });

  it('emits one channelName change with its index', () => {
    const a = makeSnapshot();
    const b = structuredClone(a);
    b.channels[3] = { ...b.channels[3], name: 'Subwoofer' };
    expect(diffSnapshots(a, b)).toEqual([{ kind: 'channelName', channelIndex: 3, value: 'Subwoofer' }]);
  });

  it('emits one band change for an above-tolerance frequency move', () => {
    const a = makeSnapshot();
    const b = structuredClone(a);
    b.channels[0].filters[2] = band({ frequency: 1000 + DIFF_TOLERANCE.freq * 2 });
    expect(diffSnapshots(a, b)).toEqual([{ kind: 'band', channelIndex: 0, band: 2, value: b.channels[0].filters[2] }]);
  });

  it('ignores a sub-tolerance band frequency move', () => {
    const a = makeSnapshot();
    const b = structuredClone(a);
    b.channels[0].filters[2] = band({ frequency: 1000 + DIFF_TOLERANCE.freq * 0.5 });
    expect(diffSnapshots(a, b)).toEqual([]);
  });

  it('emits one band change when only bypass flips (closes the SP1 gap)', () => {
    const a = makeSnapshot();
    const b = structuredClone(a);
    b.channels[0].filters[2] = band({ bypass: true });
    expect(diffSnapshots(a, b)).toEqual([{ kind: 'band', channelIndex: 0, band: 2, value: b.channels[0].filters[2] }]);
  });

  it('emits an output change on an enabled flip', () => {
    const a = makeSnapshot();
    const b = structuredClone(a);
    b.outputs[1] = { ...b.outputs[1], enabled: !b.outputs[1].enabled };
    expect(diffSnapshots(a, b)).toEqual([{ kind: 'output', index: 1, value: b.outputs[1] }]);
  });

  it('ignores sub-tolerance output delay drift', () => {
    const a = makeSnapshot();
    const b = structuredClone(a);
    b.outputs[0] = { ...b.outputs[0], delayMs: DIFF_TOLERANCE.ms * 0.5 };
    expect(diffSnapshots(a, b)).toEqual([]);
  });

  it('emits a route change when a route appears (b has more routes than a)', () => {
    const a = makeSnapshot();
    const b = structuredClone(a);
    // Remove the last route from a so b[last] is absent in a — diffSnapshots
    // treats undefined a.routes[i] as a change and emits the b value.
    const lastIdx = b.routes.length - 1;
    a.routes = a.routes.slice(0, lastIdx);
    expect(diffSnapshots(a, b)).toEqual([{ kind: 'route', index: lastIdx, value: b.routes[lastIdx] }]);
  });

  it('emits a route change on an enabled flip', () => {
    const a = makeSnapshot();
    const b = structuredClone(a);
    b.routes[0] = { ...b.routes[0], enabled: !b.routes[0].enabled };
    expect(diffSnapshots(a, b)).toEqual([{ kind: 'route', index: 0, value: b.routes[0] }]);
  });

  it('emits loudness / crossfeed / leveller section changes', () => {
    const a = makeSnapshot();
    const bLoudness = structuredClone(a);
    bLoudness.loudness = { enabled: true, refSpl: 85, intensityPct: 0 };
    expect(diffSnapshots(a, bLoudness))
      .toEqual([{ kind: 'loudness', value: { enabled: true, refSpl: 85, intensityPct: 0 } }]);

    const bCf = structuredClone(a);
    bCf.crossfeed = { ...bCf.crossfeed, enabled: true };
    expect(diffSnapshots(a, bCf)).toEqual([{ kind: 'crossfeed', value: bCf.crossfeed }]);

    const bLev = structuredClone(a);
    bLev.leveller = { ...bLev.leveller, enabled: true };
    expect(diffSnapshots(a, bLev)).toEqual([{ kind: 'leveller', value: bLev.leveller }]);
    expect(diffSnapshots(bLev, structuredClone(bLev))).toEqual([]);
  });

  it('collects multiple simultaneous changes', () => {
    const a = makeSnapshot();
    const b = structuredClone(a);
    b.bypass = true;
    b.masterVolumeDb = -6;
    const changes = diffSnapshots(a, b);
    expect(changes).toContainEqual({ kind: 'bypass', value: true });
    expect(changes).toContainEqual({ kind: 'masterVolume', value: -6 });
    expect(changes).toHaveLength(2);
  });
});

describe('diffSnapshots — 1.1.4 sections', () => {
  it('emits no section changes when both sides are null', () => {
    // Default V6 snapshot: all optional sections null.
    const a = makeSnapshot();
    expect(diffSnapshots(a, makeSnapshot())).toEqual([]);
  });

  it('emits inputConfig on a source change', () => {
    const a = makeV10();
    const b = structuredClone(a);
    b.inputConfig = { ...b.inputConfig!, source: 1 };
    expect(diffSnapshots(a, b)).toEqual([{ kind: 'inputConfig', value: b.inputConfig }]);
  });

  it('emits userVolume on a volume/mute change (above tolerance)', () => {
    const a = makeV10();
    const b = structuredClone(a);
    b.userVolume = { ...b.userVolume!, volumeDb: -6 };
    expect(diffSnapshots(a, b)).toEqual([{ kind: 'userVolume', value: b.userVolume }]);
  });

  it('emits dacHwMute on a config change', () => {
    const a = makeV10();
    const b = structuredClone(a);
    b.dacHwMute = { ...b.dacHwMute!, enabled: !b.dacHwMute!.enabled };
    expect(diffSnapshots(a, b)).toEqual([{ kind: 'dacHwMute', value: b.dacHwMute }]);
  });

  it('splits lgSoundSync: enabled vs runtime status', () => {
    const base = makeV10();
    // enabled flip only.
    const bEnabled = structuredClone(base);
    bEnabled.lgSoundSync = { ...bEnabled.lgSoundSync!, enabled: !bEnabled.lgSoundSync!.enabled };
    expect(diffSnapshots(base, bEnabled)).toEqual([{ kind: 'lgSoundSyncEnabled', value: bEnabled.lgSoundSync.enabled }]);

    // status change only (present/volume/muted; enabled stays same).
    const bStatus = structuredClone(base);
    bStatus.lgSoundSync = { ...bStatus.lgSoundSync!, present: true, volume: 40 };
    expect(diffSnapshots(base, bStatus))
      .toEqual([{ kind: 'lgSoundSyncStatus', value: { present: true, volume: 40, muted: bStatus.lgSoundSync.muted } }]);
  });

  it('emits both lgSoundSync kinds when enabled AND status change', () => {
    const a = makeV10();
    const b = structuredClone(a);
    b.lgSoundSync = { enabled: !a.lgSoundSync!.enabled, present: true, volume: 40, muted: false };
    const changes = diffSnapshots(a, b);
    expect(changes).toContainEqual({ kind: 'lgSoundSyncEnabled', value: b.lgSoundSync.enabled });
    expect(changes).toContainEqual({ kind: 'lgSoundSyncStatus', value: { present: true, volume: 40, muted: false } });
    expect(changes).toHaveLength(2);
  });
});

describe('diffSnapshots — i2s + output pins', () => {
  it('emits no i2s/pins change for identical snapshots', () => {
    const a = makeSnapshot((b) => { b.numPinOutputs = 2; b.pins[0] = 6; b.pins[1] = 7; });
    expect(diffSnapshots(a, structuredClone(a))).toEqual([]);
  });

  it('emits i2s on a pin change', () => {
    const a = makeSnapshot();
    const b = structuredClone(a);
    b.i2s = { ...b.i2s, bckPin: 20 };
    expect(diffSnapshots(a, b)).toEqual([{ kind: 'i2s', value: b.i2s }]);
  });

  it('emits i2s on an outputSlotTypes change', () => {
    const a = makeSnapshot();
    const b = structuredClone(a);
    b.i2s = { ...b.i2s, outputSlotTypes: [0, 1, 0, 0] };
    expect(diffSnapshots(a, b)).toEqual([{ kind: 'i2s', value: b.i2s }]);
  });

  it('emits outputPins on a pin value change', () => {
    const a = makeSnapshot((b) => { b.numPinOutputs = 2; b.pins[0] = 6; b.pins[1] = 7; });
    const b = structuredClone(a);
    b.outputPins = [6, 8];
    expect(diffSnapshots(a, b)).toEqual([{ kind: 'outputPins', value: [6, 8] }]);
  });

  it('emits outputPins on a length change', () => {
    const a = makeSnapshot((b) => { b.numPinOutputs = 2; b.pins[0] = 6; b.pins[1] = 7; });
    const b = structuredClone(a);
    b.outputPins = [...b.outputPins, 8];
    expect(diffSnapshots(a, b)).toEqual([{ kind: 'outputPins', value: [6, 7, 8] }]);
  });

  it('emits no outputPins change for identical pins', () => {
    const a = makeSnapshot((b) => { b.numPinOutputs = 3; b.pins[0] = 6; b.pins[1] = 7; b.pins[2] = 8; });
    expect(diffSnapshots(a, structuredClone(a))).toEqual([]);
  });
});
