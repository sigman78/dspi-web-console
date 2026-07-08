// Applies an AutoEQ library entry's bands + preamp onto a channel (and
// optionally its stereo twin).

import {
  type ChannelId, type ChannelModel, type AutoEqEntry,
  groupIntoPairs, groupInputSlotPairs, inputIndexOf, autoEqFiltersToBands, isFirstOrderType, defaultFilter,
} from '@/domain';
import type { ReadySession } from '@/state';
import { setEqFilter, setInputPreamp, setOutputGain } from './actions';

export function preampTargetLabel(channel: { isOutput: boolean }): 'INPUT PREAMP' | 'OUTPUT TRIM' {
  return channel.isOutput ? 'OUTPUT TRIM' : 'INPUT PREAMP';
}

// Stereo-twin lookup for "apply to pair": output names are always true L/R,
// so suffix pairing (groupIntoPairs) still works; USB input defaults drop
// L/R (defaultInputName), so inputs pair by slot position instead
// (groupInputSlotPairs) -- same structural pairing the rail uses.
function twinGroup(channels: readonly ChannelModel[], channelId: ChannelId): ChannelModel[] | null {
  const target = channels.find((c) => c.id === channelId);
  if (!target) return null;
  const groups = target.isOutput
    ? groupIntoPairs(channels.filter((c) => c.isOutput))
    : groupInputSlotPairs(channels.filter((c) => !c.isOutput));
  return groups.find((g) => g.members.length === 2 && g.members.some((c) => c.id === channelId))?.members ?? null;
}

export function hasStereoTwin(channels: readonly ChannelModel[], channelId: ChannelId): boolean {
  return twinGroup(channels, channelId) !== null;
}

function twinOf(s: ReadySession, channelId: ChannelId): ChannelId | null {
  return twinGroup(s.mirror.snapshot.channels, channelId)?.find((c) => c.id !== channelId)?.id ?? null;
}

export function applyAutoEqEntry(
  s: ReadySession,
  channelId: ChannelId,
  entry: AutoEqEntry,
  includePairTwin: boolean,
): void {
  const targets: ChannelId[] = [channelId];
  if (includePairTwin) {
    const twin = twinOf(s, channelId);
    if (twin != null) targets.push(twin);
  }

  // Saved user entries may carry first-order sections the target device
  // cannot express; those bands flatten instead of going to the wire.
  const firstOrderOk = s.device.capabilities.features.firstOrderEq;
  const bands = autoEqFiltersToBands(entry.filters).map((b) =>
    !firstOrderOk && isFirstOrderType(b.type) ? defaultFilter() : b,
  );
  for (const id of targets) {
    const ch = s.mirror.snapshot.channels.find((c) => c.id === id);
    if (!ch) continue;
    const len = Math.min(bands.length, ch.filters.length);
    for (let i = 0; i < len; i++) {
      setEqFilter(s, id, i, bands[i]);
    }

    const inputIdx = inputIndexOf(id);
    if (inputIdx !== null) {
      setInputPreamp(s, inputIdx, entry.preamp);
      continue;
    }
    const out = s.mirror.snapshot.outputs.find((o) => o.id === id);
    if (out) setOutputGain(s, out.wireIndex, entry.preamp);
  }
}
