// UI-only mark of the "copy source" preset slot, owned by the active device
// session. Set by COPY, cleared by DROP, successful PASTE, dirty-RAM
// transitions, tab switches, and disconnect. Not persisted across reloads.

import type { PresetSlot } from '@/domain';
import { activeSession } from './appState.svelte';

export const copySource = {
  get slot(): PresetSlot | null { return activeSession()?.copySource.slot ?? null; },
};

export function setCopySource(slot: PresetSlot | null): void {
  const s = activeSession();
  if (s) s.copySource.slot = slot;
}

export function clearCopySource(): void {
  const s = activeSession();
  if (s) s.copySource.slot = null;
}
