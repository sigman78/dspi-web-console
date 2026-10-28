import type { ReadySession } from '@/state';
import { saveActivePreset, renamePresetSlot } from '@/runtime';

// Saving into an unoccupied, unnamed slot names it "Preset N" first so the
// slot doesn't land in the directory anonymous.
export async function saveActivePresetNamed(s: ReadySession): Promise<void> {
  if (s.presets.busy) return;
  const active = s.presets.active;
  if (active == null) return;
  const occupied = s.presets.directory?.occupiedSlotsSet.has(active) ?? false;
  if (!occupied && (s.presets.names[active] ?? '').length === 0) {
    await renamePresetSlot(s, active, `Preset ${active + 1}`);
  }
  await saveActivePreset(s);
}
