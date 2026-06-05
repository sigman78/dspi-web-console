// Domain view of GetPresetDir (0x95). Wire `number`s upgraded to semantic
// types; 0xFF "no last active" collapses to `null`.

import type { PresetSlot } from './presetLimits';
import type { PresetStartupMode } from '@/protocol';
import type { MasterVolumeMode } from './processing';

export interface PresetDirectoryInfo {
  // Populated slots, built from the firmware's u16 bitmask. No write-back
  // to firmware exists.
  occupiedSlotsSet: ReadonlySet<PresetSlot>;

  // Union keeps forward-compat: unknown future firmware values surface as a
  // raw byte rather than being mis-typed at the parse boundary.
  startupMode: PresetStartupMode | number;

  // Only meaningful when startupMode === PresetStartupMode.Specified.
  defaultSlot: PresetSlot;

  // 0..9, or `null` when firmware reports 0xFF ("no slot ever active").
  lastActiveSlot: PresetSlot | null;

  includePins: boolean;

  // V12+: 0=Independent, 1=WithPreset. Legacy firmware -> 0 (Independent).
  masterVolumeMode: MasterVolumeMode;
}
