// EQ link groups: channels whose EQ edits are mirrored while the group is
// locked. Console-only; firmware has no notion of them.

import { groupIntoPairs, groupInputSlotPairs, inputIndexOf, type ChannelId } from './channels';
import { AudioInputSource } from './deviceSections';
import type { ChannelModel } from './snapshot';

export type EqLinkGroup = readonly ChannelId[];

export function eqLinkGroupKey(group: EqLinkGroup): string {
  return group.join('+');
}

// Output L/R pairs always; input slot pairs only where the source carries a
// true stereo pair (a 2-channel upmix input keeps its derived busses unpaired).
export function defaultEqLinkGroups(
  channels: readonly ChannelModel[],
  source: AudioInputSource,
  activeInputs: number | null,
): EqLinkGroup[] {
  const outputs = groupIntoPairs(channels.filter((c) => c.isOutput))
    .filter((g) => g.members.length === 2)
    .map((g) => g.members.map((c) => c.id));

  const live = activeInputs ?? channels.filter((c) => !c.isOutput).length;
  let inputs = groupInputSlotPairs(channels.filter((c) => !c.isOutput))
    .filter((g) => g.members.length === 2)
    .map((g) => g.members.map((c) => c.id));
  if (source === AudioInputSource.Usb) {
    inputs = live === 2 ? inputs.slice(0, 1) : [];
  } else {
    const limit = Math.max(2, live);
    inputs = inputs.filter((g) => (inputIndexOf(g[0]) ?? Infinity) < limit);
  }
  return [...outputs, ...inputs];
}

export function eqLinkGroupOf(groups: readonly EqLinkGroup[], id: ChannelId): EqLinkGroup | null {
  return groups.find((g) => g.includes(id)) ?? null;
}
