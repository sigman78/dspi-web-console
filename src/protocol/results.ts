import { Result } from '@/utils';

// FlashResult -- returned by SaveParams (0x51) and FactoryReset (0x53).
export const FlashResult = {
  Ok:        0x00,
  ErrWrite:  0x01,
  ErrNoData: 0x02,
  ErrCrc:    0x03,
} as const;
export type FlashResult = (typeof FlashResult)[keyof typeof FlashResult];

// PresetResult -- returned by every Preset* command (0x90-0x9A) plus
// SaveMasterVolume (0xD6) and SaveOutputConfig (0x52, V10+).
export const PresetResult = {
  Ok:              0x00,
  InvalidSlot:     0x01,
  SlotEmpty:       0x02,
  CrcFailure:      0x03,
  FlashWriteError: 0x04,
} as const;
export type PresetResult = (typeof PresetResult)[keyof typeof PresetResult];

const flashCodes = new Set<number>(Object.values(FlashResult));
const presetCodes = new Set<number>(Object.values(PresetResult));

const flashMessage: Record<FlashResult, string> = {
  [FlashResult.Ok]:        'ok',
  [FlashResult.ErrWrite]:  'flash write error',
  [FlashResult.ErrNoData]: 'no data to load',
  [FlashResult.ErrCrc]:    'flash CRC failure',
};

const presetMessage: Record<PresetResult, string> = {
  [PresetResult.Ok]:              'ok',
  [PresetResult.InvalidSlot]:     'invalid preset slot',
  [PresetResult.SlotEmpty]:       'preset slot is empty',
  [PresetResult.CrcFailure]:      'preset CRC failure',
  [PresetResult.FlashWriteError]: 'preset flash write error',
};

export function flashResultFromByte(byte: number): Result<void, FlashResult> {
  if (byte === FlashResult.Ok) return Result.ok();
  const code: FlashResult = flashCodes.has(byte)
    ? (byte as FlashResult)
    : FlashResult.ErrWrite;
  return Result.fail(code, flashMessage[code]);
}

export function presetResultFromByte(byte: number): Result<void, PresetResult> {
  if (byte === PresetResult.Ok) return Result.ok();
  const code: PresetResult = presetCodes.has(byte)
    ? (byte as PresetResult)
    : PresetResult.FlashWriteError;
  return Result.fail(code, presetMessage[code]);
}

// PinConfigResult -- returned by output-pin (0x7C), output-type (0xC0), and
// I2S/MCK pin commands (0xC2/0xC6/0xC8).
export const PinConfigResult = {
  Success:       0x00,
  InvalidPin:    0x01,
  PinInUse:      0x02,
  InvalidOutput: 0x03,
  OutputActive:  0x04,
  // fw 1.1.5+: a value outside its accepted range (UART baud, I2C address),
  // as opposed to a pin conflict.
  InvalidParam:  0x05,
} as const;
export type PinConfigResult = (typeof PinConfigResult)[keyof typeof PinConfigResult];

const pinConfigCodes = new Set<number>(Object.values(PinConfigResult));

const pinConfigMessage: Record<PinConfigResult, string> = {
  [PinConfigResult.Success]:       'ok',
  [PinConfigResult.InvalidPin]:    'invalid or reserved GPIO pin',
  [PinConfigResult.PinInUse]:      'GPIO pin already in use',
  [PinConfigResult.InvalidOutput]: 'invalid output index',
  [PinConfigResult.OutputActive]:  'output is active; disable it first',
  [PinConfigResult.InvalidParam]:  'value out of range',
};

export function pinConfigResultFromByte(byte: number): Result<void, PinConfigResult> {
  if (byte === PinConfigResult.Success) return Result.ok();
  const code: PinConfigResult = pinConfigCodes.has(byte)
    ? (byte as PinConfigResult)
    : PinConfigResult.InvalidPin;
  return Result.fail(code, pinConfigMessage[code]);
}
