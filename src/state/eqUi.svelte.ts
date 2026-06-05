import type { ChannelId } from '@/domain';

// EQ copy-source selection. Holds only the armed source channel (so it stays a
// state-layer leaf); the paste is a runtime action the consumer calls directly.
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
