import { describe, it, expect } from 'vitest';
import { applyChange } from './applyChange';
import { diffSnapshots } from './snapshotDiff';
import type { DspSnapshot, ChannelModel } from './snapshot';
import type { OutputModel, RouteModel } from './mixer';
import type { FilterParams } from './filter';

function band(o: Partial<FilterParams> = {}): FilterParams {
  return { type: 0, bypass: false, frequency: 1000, q: 1.0, gain: 0, ...o };
}
function channel(id: number, name = `ch${id}`): ChannelModel {
  return { id: id as any, name, defaultName: name, shortName: `c${id}`, bandCount: 12, isOutput: false, outputMode: null, filters: Array.from({ length: 12 }, () => band()) };
}
function output(id: number): OutputModel {
  return { id: id as any, wireIndex: 0 as any, name: `out${id}`, shortName: `o${id}`, outputMode: 'Analog' as any, enabled: true, muted: false, gainDb: 0, delayMs: 0 };
}
function route(i: number, o: number): RouteModel {
  return { inputIndex: i as any, inputName: `in${i}`, outputId: o as any, outputWireIndex: 0 as any, outputName: `out${o}`, enabled: false, invert: false, gainDb: 0 };
}
function snap(overrides: Partial<DspSnapshot> = {}): DspSnapshot {
  const base: DspSnapshot = {
    platform: { name: 'rp2350', type: 'rp2350', totalChannelCount: 11, outputCount: 4 } as any,
    bypass: false, masterPreampDb: 0, inputPreampDb: [0, 0], masterVolumeDb: 0,
    channels: Array.from({ length: 11 }, (_, i) => channel(i)),
    outputs: Array.from({ length: 4 }, (_, i) => output(i + 7)),
    routes: [route(0, 7)],
    loudness: { enabled: false, refSpl: 85, intensityPct: 0 },
    crossfeed: { enabled: false, preset: 0, itd: false, freq: 700, feedDb: 4.5 } as any,
    leveller: { enabled: false, speed: 1, lookahead: false, amount: 0, maxGainDb: 0, gateDb: -40 } as any,
    i2s: { outputSlotTypes: [0, 0, 0, 0], bckPin: 14, mckPin: 13, mckEnabled: false, mckMultiplierEncoded: 0 } as any,
    outputPins: [6, 7],
    inputConfig: null, lgSoundSync: null, userVolume: null, dacHwMute: null,
  };
  return structuredClone({ ...base, ...overrides });
}

describe('applyChange', () => {
  it('applies a single kind in place', () => {
    const t = snap();
    applyChange({ kind: 'bypass', value: true }, t);
    expect(t.bypass).toBe(true);
    applyChange({ kind: 'band', channel: 2, band: 4, value: band({ gain: 6 }) }, t);
    expect(t.channels[2].filters[4].gain).toBe(6);
    applyChange({ kind: 'inputPreamp', channel: 1, value: -3 }, t);
    expect(t.inputPreampDb[1]).toBe(-3);
    applyChange({ kind: 'outputPins', value: [6, 8] }, t);
    expect(t.outputPins).toEqual([6, 8]);
  });

  it('applies lgSoundSync split kinds when the section is present, skips when null', () => {
    const t = snap({ lgSoundSync: { enabled: false, present: false, volume: 0, muted: false } as any });
    applyChange({ kind: 'lgSoundSyncEnabled', value: true }, t);
    applyChange({ kind: 'lgSoundSyncStatus', value: { present: true, volume: 40, muted: false } }, t);
    expect(t.lgSoundSync).toEqual({ enabled: true, present: true, volume: 40, muted: false });
    // null section: a status change is a no-op, not a crash
    const t2 = snap({ lgSoundSync: null });
    applyChange({ kind: 'lgSoundSyncEnabled', value: true }, t2);
    expect(t2.lgSoundSync).toBeNull();
  });

  it('round-trips: applying diffSnapshots(a,b) onto a reproduces b', () => {
    const a = snap();
    const b = snap({
      bypass: true, masterVolumeDb: -6, masterPreampDb: -2, inputPreampDb: [0, -1],
      loudness: { enabled: true, refSpl: 80, intensityPct: 0.5 },
      crossfeed: { enabled: true, preset: 1, itd: true, freq: 650, feedDb: 3 } as any,
      leveller: { enabled: true, speed: 1, lookahead: false, amount: 50, maxGainDb: 12, gateDb: -50 } as any,
      inputConfig: { source: 1, spdifRxPin: 5 } as any,
      userVolume: { volumeDb: -4, mute: true } as any,
      dacHwMute: { enabled: true, activeLow: true, pin: 11, holdMs: 5, releaseMs: 7 } as any,
      i2s: { outputSlotTypes: [0, 1, 0, 0], bckPin: 14, mckPin: 13, mckEnabled: false, mckMultiplierEncoded: 0 } as any,
      outputPins: [6, 8],
    });
    b.channels[3].name = 'Sub';
    b.channels[0].filters[2] = band({ gain: 4, bypass: true });
    b.outputs[1].enabled = false;
    b.routes[0] = { ...route(0, 7), enabled: true };

    for (const c of diffSnapshots(a, b)) applyChange(c, a);
    expect(a).toEqual(b);
  });
});
