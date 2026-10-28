// Applies an AutoEQ library entry's bands + preamp onto a channel and, while
// its EQ link group is locked, every other group member.

import * as Domain from '@/domain';
import type { ChannelId, AutoEqEntry } from '@/domain';
import type { ReadySession } from '@/state';
import { setEqFilter } from './eqActions';
import { setInputPreamp, setOutputGain } from './mixerActions';

export function preampTargetLabel(channel: { isOutput: boolean }): 'INPUT PREAMP' | 'OUTPUT TRIM' {
  return channel.isOutput ? 'OUTPUT TRIM' : 'INPUT PREAMP';
}

export function applyAutoEqEntry(
  s: ReadySession,
  channelId: ChannelId,
  entry: AutoEqEntry,
): void {
  const targets = s.eqLink.membersOf(channelId);

  const bands = Domain.autoEqFiltersToBands(entry.filters);
  for (const id of targets) {
    const ch = s.mirror.snapshot.channels.find((c) => c.id === id);
    if (!ch) continue;
    const len = Math.min(bands.length, ch.filters.length);
    for (let i = 0; i < len; i++) {
      setEqFilter(s, id, i, bands[i]);
    }

    const inputIdx = Domain.inputIndexOf(id);
    if (inputIdx !== null) {
      setInputPreamp(s, inputIdx, entry.preamp);
      continue;
    }
    const out = s.mirror.snapshot.outputs.find((o) => o.id === id);
    if (out) setOutputGain(s, out.wireIndex, entry.preamp);
  }
}
