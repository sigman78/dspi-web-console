import { describe, it, expect } from 'vitest';
import {
  ALL_CHANNELS, AudioInputSource, ChannelId, defaultFilter,
  defaultEqLinkGroups, eqLinkGroupKey, eqLinkGroupOf,
  type ChannelModel, type EqLinkGroup,
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
