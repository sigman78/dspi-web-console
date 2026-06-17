import { describe, test, expect } from 'vitest';
import { ChannelId, groupIntoPairs } from './channels';

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
