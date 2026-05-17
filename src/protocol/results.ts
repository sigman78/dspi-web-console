// src/protocol/results.ts
import type { DspTransport } from '@/transport/DspTransport';
import { Result } from '@/utils';

// FlashResult — returned by SaveParams (0x51), LoadParams (0x52), FactoryReset (0x53).
// Mirrors `FlashResult` in DspDevice.cs.
export const FlashResult = {
  Ok:        0x00,
  ErrWrite:  0x01,
  ErrNoData: 0x02,
  ErrCrc:    0x03,
} as const;
export type FlashResult = (typeof FlashResult)[keyof typeof FlashResult];

// PresetResult — returned by every Preset* command (0x90–0x9A) plus
// SaveMasterVolume (0xD6). Mirrors `PresetResult` in DspDevice.cs.
export const PresetResult = {
  Ok:              0x00,
  InvalidSlot:     0x01,
  SlotEmpty:       0x02,
  CrcFailure:      0x03,
  FlashWriteError: 0x04,
} as const;
export type PresetResult = (typeof PresetResult)[keyof typeof PresetResult];

// Action-style IN: control-IN that the firmware uses to *trigger* a side
// effect and return a 1-byte status code. Returns 0xFF if the response
// is empty (transport-level failure short of a throw).
export async function actionCmd(
  t: DspTransport,
  cmd: { code: number },
  wValue = 0,
): Promise<number> {
  const r = await t.ctrlIn(cmd.code, wValue, 1);
  return r.length >= 1 ? r[0] : 0xFF;
}

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
  if (byte === FlashResult.Ok) return Result.ok(undefined);
  const code: FlashResult = flashCodes.has(byte)
    ? (byte as FlashResult)
    : FlashResult.ErrWrite;
  return Result.fail(code, flashMessage[code]);
}

export function presetResultFromByte(byte: number): Result<void, PresetResult> {
  if (byte === PresetResult.Ok) return Result.ok(undefined);
  const code: PresetResult = presetCodes.has(byte)
    ? (byte as PresetResult)
    : PresetResult.FlashWriteError;
  return Result.fail(code, presetMessage[code]);
}
