import { createAckHold } from '@/components/chrome/ackHold.svelte';
import type { ChannelId, FilterParams } from '@/domain';
import type { ReadySession } from '@/state';
import { sameBand } from './eqDraft';

export interface BandDraft {
  channelId: ChannelId;
  kind: 'peq' | 'xover';
  index: number;
  band: FilterParams;
}

/** The band being edited right now; the EQ graph draws it in place of the mirror's band. */
export const bandDraft = $state<{ current: BandDraft | null }>({ current: null });

/** A written band, kept on screen until the mirror shows it. */
export const bandHold = createAckHold<BandDraft>();

export function holdBand(s: ReadySession, d: BandDraft): void {
  bandHold.begin(d, () => {
    const channel = s.mirror.current?.channels.find((c) => c.id === d.channelId);
    const cur = (d.kind === 'peq' ? channel?.filters : channel?.xoverBands)?.[d.index];
    return cur !== undefined && sameBand(cur, d.band);
  });
}
