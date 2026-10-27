import { defaultFilter, seedTypeChange, type ChannelModel, type FilterParams } from '@/domain';
import { setBandBypass, setEqFilter } from '@/runtime';
import type { ReadySession } from '@/state';

/** Same field-by-field edit path as the former tabbed EQ: bypass has its own verb, a type switch seeds fields. */
export function patchBand(s: ReadySession, channel: ChannelModel, i: number, patch: Partial<FilterParams>): void {
  if (patch.bypass !== undefined) setBandBypass(s, channel.id, i, patch.bypass);
  const { bypass: _bypass, ...rest } = patch;
  if (Object.keys(rest).length === 0) return;
  const current = channel.filters[i];
  const seed = rest.type !== undefined ? seedTypeChange(current, rest.type) : {};
  setEqFilter(s, channel.id, i, { ...current, ...rest, ...seed });
}

export function clearBand(s: ReadySession, channel: ChannelModel, i: number): void {
  setEqFilter(s, channel.id, i, defaultFilter());
}

export function resetBands(s: ReadySession, channel: ChannelModel): void {
  for (let i = 0; i < channel.filters.length; i++) clearBand(s, channel, i);
}
