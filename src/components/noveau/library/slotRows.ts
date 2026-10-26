import type { PresetSlot } from '@/domain';

export interface SlotRow {
  slot: PresetSlot;
  name: string;
  occupied: boolean;
  active: boolean;
  startup: boolean;
  dirty: boolean;
  copied: boolean;
}

export interface SlotRowsInput {
  slots: readonly PresetSlot[];
  names: readonly (string | null)[];
  occupied: ReadonlySet<PresetSlot> | null;
  active: PresetSlot | null;
  // The boot slot, or null when the device boots into the last active preset.
  startup: PresetSlot | null;
  dirty: boolean;
  copiedSlot: PresetSlot | null;
}

export function slotRows(i: SlotRowsInput): SlotRow[] {
  return i.slots.map((slot) => ({
    slot,
    name: i.names[slot] ?? '',
    occupied: i.occupied?.has(slot) ?? false,
    active: slot === i.active,
    startup: slot === i.startup,
    dirty: slot === i.active && i.dirty,
    copied: slot === i.copiedSlot,
  }));
}
