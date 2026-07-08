import { describe, test, expect } from 'vitest';
import { ChannelId, groupIntoPairs, groupInputSlotPairs } from './channels';

type Ch = { id: ChannelId; shortName: string };

const OUTPUTS: Ch[] = [
  { id: ChannelId.Out1L, shortName: '1L' },
  { id: ChannelId.Out1R, shortName: '1R' },
  { id: ChannelId.Out2L, shortName: '2L' },
  { id: ChannelId.Out2R, shortName: '2R' },
  { id: ChannelId.Out3L, shortName: '3L' },
  { id: ChannelId.Out3R, shortName: '3R' },
  { id: ChannelId.Out4L, shortName: '4L' },
  { id: ChannelId.Out4R, shortName: '4R' },
  { id: ChannelId.Pdm, shortName: 'PDM' },
];

describe('groupIntoPairs', () => {
  test('folds outputs into four L/R pairs plus a PDM single', () => {
    const groups = groupIntoPairs(OUTPUTS);
    expect(groups.map((g) => g.members.length)).toEqual([2, 2, 2, 2, 1]);
    expect(groups.map((g) => g.accentId)).toEqual([
      ChannelId.Out1L, ChannelId.Out2L, ChannelId.Out3L, ChannelId.Out4L, ChannelId.Pdm,
    ]);
  });

  test('pairs the stereo input', () => {
    const groups = groupIntoPairs([
      { id: ChannelId.In1L, shortName: 'I1L' },
      { id: ChannelId.In1R, shortName: 'I1R' },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].members.map((m) => m.id)).toEqual([ChannelId.In1L, ChannelId.In1R]);
  });

  test('a lone L with no following R degrades to singles', () => {
    const groups = groupIntoPairs([
      { id: ChannelId.Out1L, shortName: '1L' },
      { id: ChannelId.Pdm, shortName: 'PDM' },
    ]);
    expect(groups.map((g) => g.members.length)).toEqual([1, 1]);
  });

  test('a single mono channel is one group', () => {
    const groups = groupIntoPairs([{ id: ChannelId.Pdm, shortName: 'PDM' }]);
    expect(groups).toEqual([{ accentId: ChannelId.Pdm, members: [{ id: ChannelId.Pdm, shortName: 'PDM' }] }]);
  });
});

describe('groupInputSlotPairs', () => {
  // Names carry no L/R suffix (mirrors USB's per-channel default naming) --
  // the point of this grouping is that it pairs by position, not name.
  const usbStyle = (count: number) =>
    Array.from({ length: count }, (_, i) => ({ id: i as ChannelId, shortName: `U${i + 1}` }));

  test('pairs a 2-channel source into one stereo pair', () => {
    const groups = groupInputSlotPairs(usbStyle(2));
    expect(groups.map((g) => g.members.length)).toEqual([2]);
    expect(groups[0].members.map((m) => m.id)).toEqual([0, 1]);
  });

  test('pairs a 4-channel source into two pairs', () => {
    const groups = groupInputSlotPairs(usbStyle(4));
    expect(groups.map((g) => g.members.length)).toEqual([2, 2]);
    expect(groups.map((g) => g.accentId)).toEqual([0, 2]);
  });

  test('pairs a 6-channel source into three pairs', () => {
    const groups = groupInputSlotPairs(usbStyle(6));
    expect(groups.map((g) => g.members.length)).toEqual([2, 2, 2]);
  });

  test('pairs an 8-channel source into four pairs', () => {
    const groups = groupInputSlotPairs(usbStyle(8));
    expect(groups.map((g) => g.members.length)).toEqual([2, 2, 2, 2]);
    expect(groups.map((g) => g.accentId)).toEqual([0, 2, 4, 6]);
  });

  test('an odd trailing channel degrades to a single', () => {
    const groups = groupInputSlotPairs(usbStyle(3));
    expect(groups.map((g) => g.members.length)).toEqual([2, 1]);
  });
});
