import type { ChannelModel } from '@/domain';
import type { EqLinkState } from '@/state';

export interface EqLinkView {
  grouped: boolean;
  locked: boolean;
  // Locked: every group member in group order; otherwise just the channel.
  members: ChannelModel[];
  // Group members other than the channel, whether or not the lock is on.
  peers: ChannelModel[];
  // Peers' short names joined with '+'; '' when ungrouped.
  label: string;
}

export function eqLinkView(
  eqLink: EqLinkState,
  channels: readonly ChannelModel[],
  channel: ChannelModel,
): EqLinkView {
  const group = eqLink.groupOf(channel.id);
  const locked = eqLink.isLocked(channel.id);
  const resolve = (ids: readonly ChannelModel['id'][]) =>
    ids.map((id) => channels.find((c) => c.id === id)).filter((c): c is ChannelModel => c !== undefined);
  const peers = group ? resolve(group.filter((id) => id !== channel.id)) : [];
  const members = locked && group ? resolve(group) : [channel];
  return {
    grouped: group !== null,
    locked,
    members,
    peers,
    label: peers.map((c) => c.shortName).join('+'),
  };
}
