import { defaultFilter, seedTypeChange, type ChannelModel, type FilterParams } from '@/domain';
import { setBandBypass, setEqFilter } from '@/runtime';
import type { ReadySession } from '@/state';

/**
 * Field-by-field band edit: bypass has its own verb, a type switch seeds fields.
 * `base` is the band the patch applies to (default: the mirror's), so a patch can
 * build on edits the mirror has not caught up with.
 */
export function patchBand(
  s: ReadySession,
  channel: ChannelModel,
  i: number,
  patch: Partial<FilterParams>,
  base: FilterParams = channel.filters[i],
): void {
  if (patch.bypass !== undefined) setBandBypass(s, channel.id, i, patch.bypass);
  const { bypass: _bypass, ...rest } = patch;
  if (Object.keys(rest).length === 0) return;
  const current = base;
  const seed = rest.type !== undefined ? seedTypeChange(current, rest.type) : {};
  setEqFilter(s, channel.id, i, { ...current, ...rest, ...seed });
}

export function clearBand(s: ReadySession, channel: ChannelModel, i: number): void {
  setEqFilter(s, channel.id, i, defaultFilter());
}

export function resetBands(s: ReadySession, channel: ChannelModel): void {
  for (let i = 0; i < channel.filters.length; i++) clearBand(s, channel, i);
}
