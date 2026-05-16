//
// UI-only mark of the "copy source" preset slot. Set by COPY,
// cleared by DROP, successful PASTE, dirty-RAM transitions, tab
// switches, and disconnect.
//
// Not persisted across reloads.

import type { PresetSlot } from '../domain/presetLimits';

export const copySource = $state<{ slot: PresetSlot | null }>({ slot: null });

export function setCopySource(slot: PresetSlot | null): void {
  copySource.slot = slot;
}

export function clearCopySource(): void {
  copySource.slot = null;
}
