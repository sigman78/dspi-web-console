import type { ChannelId } from '../../domain';
import { copyEqBands } from '../../runtime';

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

// Copy source channel's bands onto target channel via the batched copy
// action. Per-channel EQ preamp is no longer a thing (it never existed in
// firmware); preamp now lives on input channels only and is not part of
// the EQ copy surface.
export function applyCopyFrom(sourceId: ChannelId, targetId: ChannelId): void {
  copyEqBands(sourceId, targetId);
}
