// Preset / persistence limits.
//
// `PresetSlot` is the index host code passes to preset vendor commands
// (0x90..0x94 in wValue). Always 10 slots; firmware rejects out-of-range
// with PresetResult.InvalidSlot.
//
// Name budgets: 32-byte NUL-terminated UTF-8 buffer (31 payload + 1 NUL),
// shared by SetPresetName (0x94) and SetChannelName (0x9B). Wire layer clips
// with utf8Truncate; UI uses these as soft `maxlength` caps.

export const PRESET_SLOT_COUNT = 10;
export const PRESET_NAME_MAX_LEN = 31;   // bytes, UTF-8
export const CHANNEL_NAME_MAX_LEN = 31;  // bytes, UTF-8

export type PresetSlot = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
