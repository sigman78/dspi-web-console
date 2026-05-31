import { describe, it, expect } from 'vitest';
import { diffSnapshots, DIFF_TOLERANCE } from './snapshotDiff';
import type { DspSnapshot, ChannelModel } from './snapshot';
import type { OutputModel, RouteModel } from './mixer';
import type { FilterParams } from './filter';

function band(o: Partial<FilterParams> = {}): FilterParams {
  return { type: 0, bypass: false, frequency: 1000, q: 1.0, gain: 0, ...o };
}

function channel(id: number, name = `ch${id}`): ChannelModel {
  return {
    id: id as any, name, defaultName: name, shortName: `c${id}`,
    bandCount: 12, isOutput: false, outputMode: null,
    filters: Array.from({ length: 12 }, () => band()),
  };
}

function output(id: number): OutputModel {
  return {
    id: id as any, wireIndex: 0 as any, name: `out${id}`, shortName: `o${id}`,
    outputMode: 'Analog' as any, enabled: true, muted: false, gainDb: 0, delayMs: 0,
  };
}

function route(inputIndex: number, outputId: number): RouteModel {
  return {
    inputIndex: inputIndex as any, inputName: `in${inputIndex}`,
    outputId: outputId as any, outputWireIndex: 0 as any, outputName: `out${outputId}`,
    enabled: false, invert: false, gainDb: 0,
  };
}

// Complete snapshot — INCLUDING the SP1 sections (null) so the fixture is valid
// for Task 2's section tests too.
export function snap(overrides: Partial<DspSnapshot> = {}): DspSnapshot {
  const base: DspSnapshot = {
    platform: { name: 'rp2350', type: 'rp2350', totalChannelCount: 11, outputCount: 4 } as any,
    bypass: false,
    masterPreampDb: 0,
    inputPreampDb: [0, 0],
    masterVolumeDb: 0,
    channels: Array.from({ length: 11 }, (_, i) => channel(i)),
    outputs: Array.from({ length: 4 }, (_, i) => output(i + 7)),
    routes: [],
    loudness: { enabled: false, refSpl: 85, intensityPct: 0 },
    crossfeed: { enabled: false, preset: 0, itd: false, freq: 700, feedDb: 4.5 } as any,
    leveller: null,
    i2s: null,
    outputPins: [],
    inputConfig: null,
    lgSoundSync: null,
    userVolume: null,
    dacHwMute: null,
  };
  return { ...base, ...overrides };
}

describe('diffSnapshots — existing coverage', () => {
  it('returns [] for identical snapshots', () => {
    expect(diffSnapshots(snap(), snap())).toEqual([]);
  });

  it('emits a bypass change', () => {
    expect(diffSnapshots(snap({ bypass: false }), snap({ bypass: true })))
      .toEqual([{ kind: 'bypass', value: true }]);
  });

  it('ignores sub-tolerance masterPreamp drift; emits above-tolerance', () => {
    expect(diffSnapshots(snap({ masterPreampDb: 0 }), snap({ masterPreampDb: DIFF_TOLERANCE.db * 0.5 }))).toEqual([]);
    expect(diffSnapshots(snap({ masterPreampDb: 0 }), snap({ masterPreampDb: DIFF_TOLERANCE.db * 2 })))
      .toEqual([{ kind: 'masterPreamp', value: DIFF_TOLERANCE.db * 2 }]);
  });

  it('treats exact-tolerance drift as no change (strict-greater boundary)', () => {
    expect(diffSnapshots(snap({ masterPreampDb: 0 }), snap({ masterPreampDb: DIFF_TOLERANCE.db }))).toEqual([]);
  });

  it('emits inputPreamp with the channel index', () => {
    expect(diffSnapshots(snap({ inputPreampDb: [0, 0] }), snap({ inputPreampDb: [0, -3] })))
      .toEqual([{ kind: 'inputPreamp', channel: 1, value: -3 }]);
  });

  it('emits masterVolume regardless of mode (gating lives in presetsDirty)', () => {
    expect(diffSnapshots(snap({ masterVolumeDb: 0 }), snap({ masterVolumeDb: -6 })))
      .toEqual([{ kind: 'masterVolume', value: -6 }]);
  });

  it('emits one channelName change with its index', () => {
    const b = snap();
    b.channels[3] = { ...b.channels[3], name: 'Subwoofer' };
    expect(diffSnapshots(snap(), b)).toEqual([{ kind: 'channelName', channel: 3, value: 'Subwoofer' }]);
  });

  it('emits one band change for an above-tolerance frequency move', () => {
    const b = snap();
    b.channels[0].filters[2] = band({ frequency: 1000 + DIFF_TOLERANCE.freq * 2 });
    expect(diffSnapshots(snap(), b)).toEqual([{ kind: 'band', channel: 0, band: 2, value: b.channels[0].filters[2] }]);
  });

  it('ignores a sub-tolerance band frequency move', () => {
    const b = snap();
    b.channels[0].filters[2] = band({ frequency: 1000 + DIFF_TOLERANCE.freq * 0.5 });
    expect(diffSnapshots(snap(), b)).toEqual([]);
  });

  it('emits one band change when only bypass flips (closes the SP1 gap)', () => {
    const b = snap();
    b.channels[0].filters[2] = band({ bypass: true });
    expect(diffSnapshots(snap(), b)).toEqual([{ kind: 'band', channel: 0, band: 2, value: b.channels[0].filters[2] }]);
  });

  it('emits an output change on an enabled flip', () => {
    const b = snap();
    b.outputs[1] = { ...b.outputs[1], enabled: false };
    expect(diffSnapshots(snap(), b)).toEqual([{ kind: 'output', index: 1, value: b.outputs[1] }]);
  });

  it('ignores sub-tolerance output delay drift', () => {
    const b = snap();
    b.outputs[0] = { ...b.outputs[0], delayMs: DIFF_TOLERANCE.ms * 0.5 };
    expect(diffSnapshots(snap(), b)).toEqual([]);
  });

  it('emits a route change when a route appears', () => {
    const r = route(0, 7);
    expect(diffSnapshots(snap({ routes: [] }), snap({ routes: [r] })))
      .toEqual([{ kind: 'route', index: 0, value: r }]);
  });

  it('emits a route change on an enabled flip', () => {
    const r0 = route(0, 7);
    const r1 = { ...route(0, 7), enabled: true };
    expect(diffSnapshots(snap({ routes: [r0] }), snap({ routes: [r1] })))
      .toEqual([{ kind: 'route', index: 0, value: r1 }]);
  });

  it('emits loudness / crossfeed / leveller section changes', () => {
    expect(diffSnapshots(snap(), snap({ loudness: { enabled: true, refSpl: 85, intensityPct: 0 } })))
      .toEqual([{ kind: 'loudness', value: { enabled: true, refSpl: 85, intensityPct: 0 } }]);

    const cf = { enabled: true, preset: 0, itd: false, freq: 700, feedDb: 4.5 } as any;
    expect(diffSnapshots(snap(), snap({ crossfeed: cf }))).toEqual([{ kind: 'crossfeed', value: cf }]);

    const lev = { enabled: false, speed: 1, lookahead: false, amount: 0, maxGainDb: 0, gateDb: -40 } as any;
    expect(diffSnapshots(snap({ leveller: null }), snap({ leveller: lev })))
      .toEqual([{ kind: 'leveller', value: lev }]);
    expect(diffSnapshots(snap({ leveller: lev }), snap({ leveller: { ...lev } }))).toEqual([]);
  });

  it('collects multiple simultaneous changes', () => {
    const b = snap({ bypass: true, masterVolumeDb: -6 });
    const changes = diffSnapshots(snap(), b);
    expect(changes).toContainEqual({ kind: 'bypass', value: true });
    expect(changes).toContainEqual({ kind: 'masterVolume', value: -6 });
    expect(changes).toHaveLength(2);
  });
});
