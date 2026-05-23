// Preset / persistence limits — slot count and name buffer sizes.
//
// `PresetSlot` is the integer index a host code passes when calling
// SavePreset / LoadPreset / DeletePreset / SetPresetName / GetPresetName
// (vendor commands 0x90..0x94 in wValue). Always 10 slots; firmware
// rejects out-of-range with PresetResult.InvalidSlot.
//
// Name byte budgets account for the 32-byte NUL-terminated UTF-8 buffer
// shared by SetPresetName (0x94) and SetChannelName (0x9B): 31 bytes of
// payload + 1 NUL. Wire layer (DspDevice) clips precisely with
// `utf8Truncate`; UI uses these as soft caps via HTML `maxlength`.

export const PRESET_SLOT_COUNT = 10;
export const PRESET_NAME_MAX_LEN = 31;   // bytes, UTF-8
export const CHANNEL_NAME_MAX_LEN = 31;  // bytes, UTF-8

export type PresetSlot = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
