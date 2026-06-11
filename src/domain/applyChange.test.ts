import { describe, it, expect } from 'vitest';
import { applyChange } from './applyChange';
import { diffSnapshots } from './snapshotDiff';
import { makeSnapshot } from '@test/fixtures/snapshotFixtures';
import * as Wire from '@/protocol/wireTypes';
import type { FilterParams } from './filter';

function band(o: Partial<FilterParams> = {}): FilterParams {
  return { type: 0, bypass: false, frequency: 1000, q: 1.0, gain: 0, ...o };
}

describe('applyChange', () => {
  it('applies a single kind in place', () => {
    const t = makeSnapshot((b) => { b.numPinOutputs = 2; b.pins[0] = 6; b.pins[1] = 7; });
    applyChange({ kind: 'bypass', value: true }, t);
    expect(t.bypass).toBe(true);
    applyChange({ kind: 'band', channelIndex: 2, band: 4, value: band({ gain: 6 }) }, t);
    expect(t.channels[2].filters[4].gain).toBe(6);
    applyChange({ kind: 'inputPreamp', channel: 1, value: -3 }, t);
    expect(t.inputPreampDb[1]).toBe(-3);
    applyChange({ kind: 'outputPins', value: [6, 8] }, t);
    expect(t.outputPins).toEqual([6, 8]);
  });

  it('applies spdifRxPin when the section is present, skips when null', () => {
    const t = makeSnapshot((b) => { b.formatVersion = 10; });
    applyChange({ kind: 'spdifRxPin', value: 9 }, t);
    expect(t.inputConfig!.spdifRxPin).toBe(9);
    const t2 = makeSnapshot((b) => { b.formatVersion = 6; b.payloadLength = Wire.BulkSizes.V6Full; });
    applyChange({ kind: 'spdifRxPin', value: 9 }, t2);
    expect(t2.inputConfig).toBeNull();
  });

  it('applies lgSoundSync split kinds when the section is present, skips when null', () => {
    // V10 snapshot carries lgSoundSync non-null.
    const t = makeSnapshot((b) => { b.formatVersion = 10; });
    applyChange({ kind: 'lgSoundSyncEnabled', value: true }, t);
    applyChange({ kind: 'lgSoundSyncStatus', value: { present: true, volume: 40, muted: false } }, t);
    expect(t.lgSoundSync).toEqual({ enabled: true, present: true, volume: 40, muted: false });
    // null section: a status change is a no-op, not a crash
    const t2 = makeSnapshot((b) => { b.formatVersion = 6; b.payloadLength = Wire.BulkSizes.V6Full; });
    applyChange({ kind: 'lgSoundSyncEnabled', value: true }, t2);
    expect(t2.lgSoundSync).toBeNull();
  });

  it('applies section appearance (null -> present) across wire versions', () => {
    // V6: inputConfig/userVolume/dacHwMute/lgSoundSync are all null.
    const before = makeSnapshot((b) => { b.formatVersion = 6; b.payloadLength = Wire.BulkSizes.V6Full; });
    // V10: all four sections present.
    const after = makeSnapshot((b) => { b.formatVersion = 10; });

    // Premise guard: fail loudly if fixture defaults change.
    expect(before.inputConfig).toBeNull();
    expect(before.userVolume).toBeNull();
    expect(before.dacHwMute).toBeNull();
    expect(before.lgSoundSync).toBeNull();
    expect(after.inputConfig).not.toBeNull();
    expect(after.userVolume).not.toBeNull();
    expect(after.dacHwMute).not.toBeNull();
    expect(after.lgSoundSync).not.toBeNull();

    const target = structuredClone(before);
    for (const c of diffSnapshots(before, after)) applyChange(c, target);

    // Whole-object equality cannot hold: lgSoundSyncEnabled/lgSoundSyncStatus
    // are no-ops when t.lgSoundSync is null (applyChange guards on the section),
    // so target.lgSoundSync stays null even after applying. Per-section
    // assertions cover the three kinds that assign directly over null.
    expect(target.inputConfig).toEqual(after.inputConfig);
    expect(target.userVolume).toEqual(after.userVolume);
    expect(target.dacHwMute).toEqual(after.dacHwMute);
  });

  it('round-trips: applying diffSnapshots(a,b) onto a reproduces b', () => {
    // Both snapshots are V10 codec-real; all optional sections present.
    const a = makeSnapshot((b) => {
      b.formatVersion = 10;
      b.numPinOutputs = 2;
      b.pins[0] = 6;
      b.pins[1] = 7;
    });
    const b = structuredClone(a);

    b.bypass = true;
    b.masterVolumeDb = -6;
    b.masterPreampDb = -2;
    b.inputPreampDb = [b.inputPreampDb[0], -1];
    b.loudness = { enabled: true, refSpl: 80, intensityPct: 0.5 };
    b.crossfeed = { ...b.crossfeed, enabled: true, preset: 1, itd: true, freq: 650, feedDb: 3 };
    b.leveller = { ...b.leveller, enabled: true, amount: 50, maxGainDb: 12, gateDb: -50 };
    b.inputConfig = { ...b.inputConfig!, source: 1 };
    b.userVolume = { volumeDb: -4, mute: true };
    b.dacHwMute = { ...b.dacHwMute!, enabled: true };
    b.i2s = { ...b.i2s, outputSlotTypes: [0, 1, 0, 0] };
    b.outputPins = [6, 8];
    b.channels[3] = { ...b.channels[3], name: 'Sub' };
    b.channels[0].filters[2] = band({ gain: 4, bypass: true });
    b.outputs[1] = { ...b.outputs[1], enabled: !b.outputs[1].enabled };
    b.routes[0] = { ...b.routes[0], enabled: !b.routes[0].enabled };

    for (const c of diffSnapshots(a, b)) applyChange(c, a);
    expect(a).toEqual(b);
  });
});
