import { describe, it, expect } from 'vitest';
import { presetDiff, PRESET_DIFF_TOLERANCE } from './presetDiff';
import type { DspSnapshot, ChannelModel } from './snapshot';
import type { OutputModel, RouteModel } from './mixer';
import type { FilterParams } from './filter';

// NOTE: FilterParams uses `frequency` (not `freqHz`) and `gain` (not `gainDb`).
// RouteModel uses `inputIndex`/`outputId` etc. (not `input`/`output`).
// These names are corrected from the spec to match the actual domain types.

function band(): FilterParams {
  return { type: 0, frequency: 1000, q: 1.0, gain: 0 };
}

function channel(id: number, name = `ch${id}`): ChannelModel {
  return {
    id: id as any,
    name,
    defaultName: name,
    shortName: `c${id}`,
    bandCount: 12,
    isOutput: false,
    outputMode: null,
    filters: Array.from({ length: 12 }, band),
  };
}

function output(id: number): OutputModel {
  return {
    id: id as any,
    wireIndex: 0 as any,
    name: `out${id}`,
    shortName: `o${id}`,
    outputMode: 'Analog' as any,
    enabled: true,
    muted: false,
    gainDb: 0,
    delayMs: 0,
  };
}

function route(inputIndex: number, outputId: number): RouteModel {
  return {
    inputIndex: inputIndex as any,
    inputName: `in${inputIndex}`,
    outputId: outputId as any,
    outputWireIndex: 0 as any,
    outputName: `out${outputId}`,
    enabled: false,
    invert: false,
    gainDb: 0,
  };
}

function snap(overrides: Partial<DspSnapshot> = {}): DspSnapshot {
  const base: DspSnapshot = {
    platform: { name: 'rp2350', type: 'rp2350', totalChannelCount: 11, outputCount: 4 } as any,
    formatVersion: 6,
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
  };
  return { ...base, ...overrides };
}

const noIgnore = { ignoreMasterVolume: false, softMuted: false };

describe('presetDiff', () => {
  it('returns false for identical snapshots', () => {
    const a = snap();
    const b = snap();
    expect(presetDiff(a, b, noIgnore)).toBe(false);
  });

  it('returns true when bypass differs', () => {
    expect(presetDiff(snap({ bypass: false }), snap({ bypass: true }), noIgnore)).toBe(true);
  });

  it('returns false for sub-tolerance dB drift on masterPreampDb', () => {
    const a = snap({ masterPreampDb: 0 });
    const b = snap({ masterPreampDb: PRESET_DIFF_TOLERANCE.db * 0.5 });
    expect(presetDiff(a, b, noIgnore)).toBe(false);
  });

  it('returns true for above-tolerance dB drift on masterPreampDb', () => {
    const a = snap({ masterPreampDb: 0 });
    const b = snap({ masterPreampDb: PRESET_DIFF_TOLERANCE.db * 2 });
    expect(presetDiff(a, b, noIgnore)).toBe(true);
  });

  it('returns true when a channel name differs', () => {
    const a = snap();
    const b = snap();
    b.channels[3] = { ...b.channels[3], name: 'Subwoofer' };
    expect(presetDiff(a, b, noIgnore)).toBe(true);
  });

  it('returns true when an EQ band frequency moves above tolerance', () => {
    const a = snap();
    const b = snap();
    b.channels[0].filters[2] = { ...b.channels[0].filters[2], frequency: 1000 + PRESET_DIFF_TOLERANCE.freq * 2 };
    expect(presetDiff(a, b, noIgnore)).toBe(true);
  });

  it('returns false when an EQ band frequency moves sub-tolerance', () => {
    const a = snap();
    const b = snap();
    b.channels[0].filters[2] = { ...b.channels[0].filters[2], frequency: 1000 + PRESET_DIFF_TOLERANCE.freq * 0.5 };
    expect(presetDiff(a, b, noIgnore)).toBe(false);
  });

  it('returns true when masterVolumeDb differs and ignoreMasterVolume=false', () => {
    expect(presetDiff(snap({ masterVolumeDb: 0 }), snap({ masterVolumeDb: -6 }), noIgnore)).toBe(true);
  });

  it('returns false when masterVolumeDb differs and ignoreMasterVolume=true (Mode 0)', () => {
    expect(presetDiff(
      snap({ masterVolumeDb: 0 }),
      snap({ masterVolumeDb: -6 }),
      { ignoreMasterVolume: true, softMuted: false },
    )).toBe(false);
  });

  it('returns false when masterVolumeDb differs and softMuted=true', () => {
    expect(presetDiff(
      snap({ masterVolumeDb: 0 }),
      snap({ masterVolumeDb: -128 }),
      { ignoreMasterVolume: false, softMuted: true },
    )).toBe(false);
  });

  it('returns true when crossfeed.enabled flips, even with ignoreMasterVolume=true', () => {
    const a = snap({ crossfeed: { enabled: false, preset: 0, itd: false, freq: 700, feedDb: 4.5 } as any });
    const b = snap({ crossfeed: { enabled: true, preset: 0, itd: false, freq: 700, feedDb: 4.5 } as any });
    expect(presetDiff(a, b, { ignoreMasterVolume: true, softMuted: false })).toBe(true);
  });

  it('returns true when an output enabled flag flips', () => {
    const a = snap();
    const b = snap();
    b.outputs[1] = { ...b.outputs[1], enabled: !b.outputs[1].enabled };
    expect(presetDiff(a, b, noIgnore)).toBe(true);
  });

  it('returns true when an output gainDb moves above tolerance', () => {
    const a = snap();
    const b = snap();
    b.outputs[0] = { ...b.outputs[0], gainDb: PRESET_DIFF_TOLERANCE.db * 2 };
    expect(presetDiff(a, b, noIgnore)).toBe(true);
  });

  it('returns false when an output delayMs drift is sub-tolerance', () => {
    const a = snap();
    const b = snap();
    b.outputs[0] = { ...b.outputs[0], delayMs: PRESET_DIFF_TOLERANCE.ms * 0.5 };
    expect(presetDiff(a, b, noIgnore)).toBe(false);
  });

  it('returns true when route count changes', () => {
    const a = snap({ routes: [] });
    const b = snap({ routes: [route(0, 7)] });
    expect(presetDiff(a, b, noIgnore)).toBe(true);
  });

  it('returns true when a route enabled flag flips', () => {
    const r0 = route(0, 7);
    const r1 = route(0, 7);
    (r1 as any).enabled = !r0.enabled;
    expect(presetDiff(snap({ routes: [r0] }), snap({ routes: [r1] }), noIgnore)).toBe(true);
  });

  it('returns true when leveller transitions from null to non-null', () => {
    const a = snap({ leveller: null });
    const b = snap({ leveller: { enabled: false, speed: 1, lookahead: false, amount: 0, maxGainDb: 0, gateDb: -40 } as any });
    expect(presetDiff(a, b, noIgnore)).toBe(true);
  });

  it('returns true when leveller content differs', () => {
    const base = { enabled: false, speed: 1, lookahead: false, amount: 0, maxGainDb: 0, gateDb: -40 } as any;
    const a = snap({ leveller: { ...base } });
    const b = snap({ leveller: { ...base, enabled: true } });
    expect(presetDiff(a, b, noIgnore)).toBe(true);
  });

  it('returns false when leveller content matches', () => {
    const base = { enabled: false, speed: 1, lookahead: false, amount: 0, maxGainDb: 0, gateDb: -40 } as any;
    expect(presetDiff(snap({ leveller: { ...base } }), snap({ leveller: { ...base } }), noIgnore)).toBe(false);
  });
});
