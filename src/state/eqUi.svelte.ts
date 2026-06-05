import type { ChannelId } from '@/domain';

// EQ copy-source selection. Ephemeral UI state: the EQ tab arms a source
// channel, then pastes its bands onto a target. The paste itself is a runtime
// action (copyEqBands) the consumer calls directly — this store only holds the
// armed selection so it stays a state-layer leaf with no runtime dependency.
export const eqUi = $state<{
  copySource: ChannelId | null;
}>({
  copySource: null,
});

export function setEqCopySource(id: ChannelId): void {
  eqUi.copySource = id;
}

export function clearEqCopySource(): void {
  eqUi.copySource = null;
}
