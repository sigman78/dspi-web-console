// Domain view of GetPresetDir (0x95). Wire-side `number`s are upgraded to
// their semantic types; 0xFF "no last active" collapses to `null`.
// See `protocol/wireTypes.ts:PresetDirectory` for the byte-level schema.

import type { PresetSlot } from './presetLimits';
import type { PresetStartupMode } from '../protocol/wireTypes';
import type { MasterVolumeMode } from './processing';

export interface PresetDirectoryInfo {
  // Populated slots. Built from the firmware's u16 bitmask; convenience
  // type because callers always ask "is slot N occupied?" or iterate.
  // Membership is a fast `.has(slot)`; no write-back to firmware exists.
  occupiedSlotsSet: ReadonlySet<PresetSlot>;

  // PresetStartupMode | number — union keeps forward-compat: future
  // firmware values surface as a raw byte rather than getting silently
  // mis-typed at the parse boundary.
  startupMode: PresetStartupMode | number;

  // Only meaningful when startupMode === PresetStartupMode.Specified.
  // Cast-through; we trust the device to keep this in 0..9.
  defaultSlot: PresetSlot;

  // 0..9, or `null` when firmware reports 0xFF ("no slot ever active").
  // Firmware spec says PresetGetActive (0x9A) never returns 0xFF but the
  // directory's last-active byte may.
  lastActiveSlot: PresetSlot | null;

  includePins: boolean;

  // V12+: 0=Independent, 1=WithPreset. Legacy firmware -> 0 (Independent).
  masterVolumeMode: MasterVolumeMode;
}
