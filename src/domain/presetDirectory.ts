// Domain view of GetPresetDir (0x95). Wire `number`s upgraded to semantic
// types; 0xFF "no last active" collapses to `null`.

import type { PresetSlot } from './presetLimits';
import type { PresetStartupMode } from '@/protocol';
import type { MasterVolumeMode } from './processing';

// Output-config persistence mode (0x98/0x99). Governs whether the physical-IO
// block (output pins, output types, I2S BCK/MCK, S/PDIF RX pin, and from fw
// V32 the output limiter) rides preset
// save/load (WithPreset) or is device-global (Independent; persisted only via
// SaveOutputConfig 0x52, never touched by preset load / factory reset / bulk
// SET).
export const OutputConfigMode = {
  Independent: 0,
  WithPreset:  1,
} as const;
export type OutputConfigMode = (typeof OutputConfigMode)[keyof typeof OutputConfigMode];

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

  // See OutputConfigMode above.
  outputConfigMode: OutputConfigMode;

  // 0=Independent, 1=WithPreset.
  masterVolumeMode: MasterVolumeMode;
}
