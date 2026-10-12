import { describe, it, expect } from 'vitest';
import {
  ALL_CHANNELS, AudioInputSource, ChannelId, FilterType, defaultFilter,
  defaultEqLinkGroups, eqLinkDiverged, eqLinkGroupKey, eqLinkGroupOf,
  type ChannelModel, type DspSnapshot, type EqLinkGroup,
} from '@/domain';

function model(id: ChannelId): ChannelModel {
  const layout = ALL_CHANNELS.find((c) => c.id === id)!;
  return {
    id, name: layout.name, defaultName: layout.name, shortName: layout.shortName,
    bandCount: 10, isOutput: layout.isOutput,
    filters: Array.from({ length: 10 }, defaultFilter),
    xoverBands: layout.isOutput ? Array.from({ length: 4 }, defaultFilter) : [],
  };
}

const INPUT_IDS = [
  ChannelId.In1L, ChannelId.In1R, ChannelId.In2L, ChannelId.In2R,
  ChannelId.In3L, ChannelId.In3R, ChannelId.In4L, ChannelId.In4R,
];
const OUTPUT_IDS = [
  ChannelId.Out1L, ChannelId.Out1R, ChannelId.Out2L, ChannelId.Out2R,
  ChannelId.Out3L, ChannelId.Out3R, ChannelId.Out4L, ChannelId.Out4R, ChannelId.Pdm,
];

function channels(inputs: number): ChannelModel[] {
  return [...INPUT_IDS.slice(0, inputs), ...OUTPUT_IDS].map((id) => model(id));
}

const keys = (groups: EqLinkGroup[]) => groups.map(eqLinkGroupKey);

describe('defaultEqLinkGroups', () => {
  it('always pairs output L/R and never groups PDM', () => {
    const groups = defaultEqLinkGroups(channels(2), AudioInputSource.Usb, 8);
    expect(keys(groups)).toEqual(['2+3', '4+5', '6+7', '8+9']);
    expect(eqLinkGroupOf(groups, ChannelId.Pdm)).toBeNull();
  });

  it('groups no inputs for USB with 8 live channels', () => {
    const groups = defaultEqLinkGroups(channels(8), AudioInputSource.Usb, 8);
    expect(groups.some((g) => g.includes(ChannelId.In1L))).toBe(false);
  });

  it('falls back to the hardware input count when the live count is unknown (USB)', () => {
    expect(keys(defaultEqLinkGroups(channels(2), AudioInputSource.Usb, null)).slice(4)).toEqual(['0+1']);
    const wide = defaultEqLinkGroups(channels(8), AudioInputSource.Usb, null);
    expect(wide.some((g) => g.includes(ChannelId.In1L))).toBe(false);
  });

  it('pairs the first input slots for USB with 2 live channels', () => {
    const groups = defaultEqLinkGroups(channels(8), AudioInputSource.Usb, 2);
    expect(keys(groups).slice(-1)).toEqual(['0+1']);
    expect(groups).toHaveLength(5);
  });

  it('pairs all four input slot pairs for I2S with 8 live channels', () => {
    const groups = defaultEqLinkGroups(channels(8), AudioInputSource.I2s, 8);
    expect(keys(groups).slice(4)).toEqual(['0+1', '11+12', '13+14', '15+16']);
  });

  it('pairs only the first input slots for I2S with 2 live channels', () => {
    const groups = defaultEqLinkGroups(channels(8), AudioInputSource.I2s, 2);
    expect(keys(groups).slice(4)).toEqual(['0+1']);
  });

  it('falls back to the hardware input count for I2S when the live count is unknown', () => {
    expect(keys(defaultEqLinkGroups(channels(2), AudioInputSource.I2s, null)).slice(4)).toEqual(['0+1']);
    expect(keys(defaultEqLinkGroups(channels(8), AudioInputSource.I2s, null)).slice(4)).toHaveLength(4);
  });

  it('pairs the S/PDIF input', () => {
    const groups = defaultEqLinkGroups(channels(2), AudioInputSource.Spdif2, null);
    expect(keys(groups).slice(4)).toEqual(['0+1']);
  });
});

describe('eqLinkGroupOf', () => {
  it('finds the containing group or null', () => {
    const groups: EqLinkGroup[] = [[ChannelId.Out1L, ChannelId.Out1R]];
    expect(eqLinkGroupOf(groups, ChannelId.Out1R)).toBe(groups[0]);
    expect(eqLinkGroupOf(groups, ChannelId.Out2L)).toBeNull();
  });
});

describe('eqLinkDiverged', () => {
  function snap(): DspSnapshot {
    const outs = OUTPUT_IDS.map((id, i) => ({
      id, wireIndex: i, shortName: '', enabled: true, muted: false, gainDb: 0, delayMs: 0,
    }));
    return {
      channels: channels(2),
      outputs: outs,
      inputPreampDb: [0, 0],
    } as unknown as DspSnapshot;
  }
  const out: EqLinkGroup = [ChannelId.Out1L, ChannelId.Out1R];
  const inp: EqLinkGroup = [ChannelId.In1L, ChannelId.In1R];
  const ch = (s: DspSnapshot, id: ChannelId) => s.channels.find((c) => c.id === id)!;

  it('is false for identical members', () => {
    const s = snap();
    expect(eqLinkDiverged(s, out)).toBe(false);
    expect(eqLinkDiverged(s, inp)).toBe(false);
  });

  it('detects a PEQ band difference, including Q-prime', () => {
    const a = snap();
    ch(a, ChannelId.Out1R).filters[3] = { ...defaultFilter(), type: FilterType.Peaking, gain: 2 };
    expect(eqLinkDiverged(a, out)).toBe(true);
  });

  it('compares Q-prime only on Linkwitz Transform bands', () => {
    const lt = { ...defaultFilter(), type: FilterType.LinkwitzTransform };
    const a = snap();
    ch(a, ChannelId.Out1L).filters[0] = { ...lt, qp: 0.5 };
    ch(a, ChannelId.Out1R).filters[0] = { ...lt, qp: 0.9 };
    expect(eqLinkDiverged(a, out)).toBe(true);
    const b = snap();
    ch(b, ChannelId.Out1L).filters[0] = { ...defaultFilter(), qp: 0 };
    ch(b, ChannelId.Out1R).filters[0] = { ...defaultFilter(), qp: undefined };
    expect(eqLinkDiverged(b, out)).toBe(false);
  });

  it('detects a bypass difference', () => {
    const s = snap();
    ch(s, ChannelId.In1R).filters[0] = { ...defaultFilter(), bypass: true };
    expect(eqLinkDiverged(s, inp)).toBe(true);
  });

  it('detects a crossover difference and tolerates members without crossover bands', () => {
    const s = snap();
    ch(s, ChannelId.Out1R).xoverBands[1] = { ...defaultFilter(), frequency: 80 };
    expect(eqLinkDiverged(s, out)).toBe(true);
    ch(s, ChannelId.Out1R).xoverBands = [];
    expect(eqLinkDiverged(s, out)).toBe(false);
  });

  it('detects input preamp difference only for input groups', () => {
    const s = snap();
    s.inputPreampDb[1] = -3;
    expect(eqLinkDiverged(s, inp)).toBe(true);
    expect(eqLinkDiverged(s, out)).toBe(false);
  });

  it('detects output gain and delay differences', () => {
    const g = snap();
    g.outputs[1].gainDb = -1;
    expect(eqLinkDiverged(g, out)).toBe(true);
    const d = snap();
    d.outputs[1].delayMs = 2;
    expect(eqLinkDiverged(d, out)).toBe(true);
  });

  it('does not throw when a member has no channel or output entry', () => {
    const s = snap();
    s.channels = s.channels.filter((c) => c.id !== ChannelId.Out1R);
    s.outputs = s.outputs.filter((o) => o.id !== ChannelId.Out1R);
    expect(eqLinkDiverged(s, out)).toBe(false);
  });
});
