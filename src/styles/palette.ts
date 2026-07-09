import { ChannelId } from '@/domain';
import { COLORS, shadeFor } from './palette-colors';
import type { ChannelKey, ShadeName } from './palette-colors';

export type { ChannelKey, ShadeName } from './palette-colors';

const KEY_BY_ID: Record<number, ChannelKey> = {
  [ChannelId.In1L]: 'In1L',
  [ChannelId.In1R]: 'In1R',
  [ChannelId.Out1L]: 'Out1L',
  [ChannelId.Out1R]: 'Out1R',
  [ChannelId.Out2L]: 'Out2L',
  [ChannelId.Out2R]: 'Out2R',
  [ChannelId.Out3L]: 'Out3L',
  [ChannelId.Out3R]: 'Out3R',
  [ChannelId.Out4L]: 'Out4L',
  [ChannelId.Out4R]: 'Out4R',
  [ChannelId.Pdm]: 'Pdm',
  [ChannelId.In2L]: 'In2L',
  [ChannelId.In2R]: 'In2R',
  [ChannelId.In3L]: 'In3L',
  [ChannelId.In3R]: 'In3R',
  [ChannelId.In4L]: 'In4L',
  [ChannelId.In4R]: 'In4R',
};

export function chKey(id: ChannelId): ChannelKey {
  const key = KEY_BY_ID[id];
  if (!key) throw new Error(`Unknown ChannelId: ${id}`);
  return key;
}

export function chShade(id: ChannelId, shade: ShadeName = 'base'): string {
  return shadeFor(COLORS[chKey(id)], shade);
}
