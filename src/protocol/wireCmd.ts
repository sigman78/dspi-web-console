// Vendor-control command codes ("`bRequest`" of the USB control transfer).
// Values mirror `VendorCommands` in `DspDevice.cs`.
//
// Each entry carries its `code` (the byte the firmware dispatches on) and,
// where the payload is a single fixed-size codec, the `codec` to use for
// encode/decode.  The `readCmd` / `writeCmd` helpers below consume those
// descriptors to remove the `sizeOf + ctrlIn + decode` ceremony from
// every device method.
//
// Commands without a `codec` are either:
//   * bit-packed wValues (GetEqParam — multi-read, see DspDevice.getFilter),
//   * variable-length payloads (GetAllParams, GetStatus, GetBufferStats),
//   * host-side unimplemented (left listed for forward reference).
//
// Both DspDevice and MockTransport access entries via `WireCmd.X.code`.

import type { DspTransport } from '../transport/DspTransport';
import { type BinCodec, Codec, decodePadded, encode, sizeOf } from '../utils/binCodec';
import * as Wire from './wireTypes';
import type { ChannelId, InputSlot, OutputSlot } from '../domain/channels';
import type { FilterType } from '../domain/filter';
import type { MasterVolumeMode } from '../domain/processing';

// Descriptor types

export interface ReadCmd<T>  { readonly code: number; readonly codec: BinCodec<T> }
export interface WriteCmd<T> { readonly code: number; readonly codec: BinCodec<T> }
export interface RawCmd      { readonly code: number }

// Re-type a wire-level codec to a narrower API-level shape. The codec at
// runtime still reads/writes raw u8/u16/etc.; this is purely a type-system
// nudge so writeCmd<T> / readCmd<T> see the typed identifier (ChannelId,
// InputSlot, FilterType, ...) instead of bare number. Required because
// BinCodec<T> is invariant in T (read returns T, write consumes T) so a
// direct assignability check fails even when the runtime values are
// compatible.
function tighten<T>(codec: BinCodec<unknown>): BinCodec<T> {
  return codec as BinCodec<T>;
}

// Payload shapes for codec-carrying commands. Named so each WireCmd entry
// references the type once instead of duplicating it across the codec
// cast and the satisfies clause.
type SetEqParamPayload = {
  channel: ChannelId; band: number; type: FilterType;
  frequency: number; q: number; gain: number;
};
type MatrixRoutePayload = {
  input: InputSlot; output: OutputSlot;
  enabled: boolean; phaseInvert: boolean; gainDb: number;
};
type DeviceInfoPayload = {
  platformId: number; fwMajor: number; fwMinorPatch: number;
};

// Command table

export const WireCmd = {
  // EQ: Set carries the 16-byte filter struct as payload (wValue=0).
  //     Get uses bit-packed wValue (channel<<8 | band<<4 | param); see DspDevice.getFilter.
  SetEqParam:           { code: 0x42, codec: tighten<SetEqParamPayload>(Wire.SetFilterPacket) } satisfies WriteCmd<SetEqParamPayload>,
  GetEqParam:           { code: 0x43 } satisfies RawCmd,

  // Global preamp (legacy, pre-V6)
  SetPreamp:            { code: 0x44, codec: Codec.f32 } satisfies WriteCmd<number>,
  GetPreamp:            { code: 0x45, codec: Codec.f32 } satisfies ReadCmd<number>,

  // Bypass: master EQ bypass (1 B bool, wValue=0).
  SetBypass:            { code: 0x46, codec: Codec.bool8 } satisfies WriteCmd<boolean>,
  GetBypass:            { code: 0x47, codec: Codec.bool8 } satisfies ReadCmd<boolean>,

  // Status / device info
  GetStatus:            { code: 0x50 } satisfies RawCmd,

  // Persistence (action-style IN; return 1-byte FlashResult).
  // On V3+ firmware these redirect through the preset system on the
  // currently-active slot. See docs/HW-PROFILES.md §2.
  SaveParams:           { code: 0x51 } satisfies RawCmd,
  LoadParams:           { code: 0x52 } satisfies RawCmd,
  FactoryReset:         { code: 0x53 } satisfies RawCmd,

  GetSerial:            { code: 0x7E, codec: Wire.Serial }     satisfies ReadCmd<string>,
  GetPlatform:          { code: 0x7F, codec: Wire.DeviceInfo } satisfies ReadCmd<DeviceInfoPayload>,
  ClearClips:           { code: 0x83 } satisfies RawCmd,

  // Channel names (round-trip; bulk read covers the same field too).
  SetChannelName:       { code: 0x9B, codec: Wire.ChannelName } satisfies WriteCmd<string>,
  GetChannelName:       { code: 0x9C, codec: Wire.ChannelName } satisfies ReadCmd<string>,

  // Per-channel preamp + master volume (V6+)
  SetInputPreamp:       { code: 0xD0, codec: Codec.f32 } satisfies WriteCmd<number>,
  GetInputPreamp:       { code: 0xD1, codec: Codec.f32 } satisfies ReadCmd<number>,
  SetMasterVolume:      { code: 0xD2, codec: Codec.f32 } satisfies WriteCmd<number>,
  GetMasterVolume:      { code: 0xD3, codec: Codec.f32 } satisfies ReadCmd<number>,
  // Master volume mode (V6+): 0 = independent/global, 1 = with-preset.
  SetMasterVolumeMode:  { code: 0xD4, codec: tighten<MasterVolumeMode>(Codec.u8) } satisfies WriteCmd<MasterVolumeMode>,
  GetMasterVolumeMode:  { code: 0xD5, codec: tighten<MasterVolumeMode>(Codec.u8) } satisfies ReadCmd<MasterVolumeMode>,
  // Action-style IN: persists current live master volume to flash, returns 1-byte status.
  // Stays RawCmd because the codec abstraction doesn't model "write-via-IN".
  SaveMasterVolume:     { code: 0xD6 } satisfies RawCmd,
  GetSavedMasterVolume: { code: 0xD7, codec: Codec.f32 } satisfies ReadCmd<number>,

  // Matrix mixer (0x70-0x79). See docs/mixer.md.
  // Per-output ops (0x72..0x79) carry the output index in wValue.
  // Matrix-route ops carry input/output in the payload (Set) or pack them
  // into wValue as `(input << 8) | output` (Get).
  SetMatrixRoute:       { code: 0x70, codec: tighten<MatrixRoutePayload>(Wire.MatrixRoutePacket) } satisfies WriteCmd<MatrixRoutePayload>,
  GetMatrixRoute:       { code: 0x71, codec: tighten<MatrixRoutePayload>(Wire.MatrixRoutePacket) } satisfies ReadCmd<MatrixRoutePayload>,
  SetOutputEnable:      { code: 0x72, codec: Codec.bool8 } satisfies WriteCmd<boolean>,
  GetOutputEnable:      { code: 0x73, codec: Codec.bool8 } satisfies ReadCmd<boolean>,
  SetOutputGain:        { code: 0x74, codec: Codec.f32 } satisfies WriteCmd<number>,
  GetOutputGain:        { code: 0x75, codec: Codec.f32 } satisfies ReadCmd<number>,
  SetOutputMute:        { code: 0x76, codec: Codec.bool8 } satisfies WriteCmd<boolean>,
  GetOutputMute:        { code: 0x77, codec: Codec.bool8 } satisfies ReadCmd<boolean>,
  SetOutputDelay:       { code: 0x78, codec: Codec.f32 } satisfies WriteCmd<number>,
  GetOutputDelay:       { code: 0x79, codec: Codec.f32 } satisfies ReadCmd<number>,

  // Bulk
  GetAllParams:         { code: 0xA0 } satisfies RawCmd,
  GetBufferStats:       { code: 0xB0 } satisfies RawCmd,
  ResetBufferStats:     { code: 0xB1 } satisfies RawCmd,

  // Presets (0x90..0x9A). See docs/HW-PROFILES.md §1b.
  // GetPresetDir / GetPresetActive carry hand-rolled payloads; the others
  // are codec-driven or action-IN.
  PresetSave:           { code: 0x90 } satisfies RawCmd,
  PresetLoad:           { code: 0x91 } satisfies RawCmd,
  PresetDelete:         { code: 0x92 } satisfies RawCmd,
  PresetGetName:        { code: 0x93, codec: Wire.ChannelName } satisfies ReadCmd<string>,
  PresetSetName:        { code: 0x94, codec: Wire.ChannelName } satisfies WriteCmd<string>,
  PresetGetDir:         { code: 0x95 } satisfies RawCmd,
  PresetSetStartup:     { code: 0x96, codec: Wire.PresetStartupConfig } satisfies WriteCmd<{ mode: number; slot: number }>,
  PresetGetStartup:     { code: 0x97, codec: Wire.PresetStartupConfig } satisfies ReadCmd<{ mode: number; slot: number }>,
  PresetSetIncludePins: { code: 0x98, codec: Codec.bool8 } satisfies WriteCmd<boolean>,
  PresetGetIncludePins: { code: 0x99, codec: Codec.bool8 } satisfies ReadCmd<boolean>,
  PresetGetActive:      { code: 0x9A } satisfies RawCmd,

  // Loudness (V4+) -- see docs/HW-TODO.md section 1
  SetLoudnessEnabled:    { code: 0x58, codec: Codec.bool8 } satisfies WriteCmd<boolean>,
  SetLoudnessRefSpl:     { code: 0x5A, codec: Codec.f32 }   satisfies WriteCmd<number>,
  SetLoudnessIntensity:  { code: 0x5C, codec: Codec.f32 }   satisfies WriteCmd<number>,

  // Crossfeed (V4+) -- see docs/HW-TODO.md section 1. Fields land in firmware order:
  // enable, preset, freq, feed, ITD. Even codes are SET, odd codes are GET.
  SetCrossfeedEnabled:   { code: 0x5E, codec: Codec.bool8 } satisfies WriteCmd<boolean>,
  SetCrossfeedPreset:    { code: 0x60, codec: Codec.u8 }    satisfies WriteCmd<number>,
  SetCrossfeedFreq:      { code: 0x62, codec: Codec.f32 }   satisfies WriteCmd<number>,
  SetCrossfeedFeedDb:    { code: 0x64, codec: Codec.f32 }   satisfies WriteCmd<number>,
  SetCrossfeedItd:       { code: 0x66, codec: Codec.bool8 } satisfies WriteCmd<boolean>,

  // Volume Leveller (V4+) -- see docs/HW-TODO.md section 1. Fields land in firmware
  // order: enable, amount, speed, max gain, lookahead, gate.
  SetLevellerEnabled:    { code: 0xB4, codec: Codec.bool8 } satisfies WriteCmd<boolean>,
  SetLevellerAmount:     { code: 0xB6, codec: Codec.f32 }   satisfies WriteCmd<number>,
  SetLevellerSpeed:      { code: 0xB8, codec: Codec.u8 }    satisfies WriteCmd<number>,
  SetLevellerMaxGain:    { code: 0xBA, codec: Codec.f32 }   satisfies WriteCmd<number>,
  SetLevellerLookahead:  { code: 0xBC, codec: Codec.bool8 } satisfies WriteCmd<boolean>,
  SetLevellerGate:       { code: 0xBE, codec: Codec.f32 }   satisfies WriteCmd<number>,
} as const;

// Helpers

// Read a fixed-size payload via a `ReadCmd<T>` descriptor.
//
// USB control-IN transfers may return fewer bytes than requested when
// the device sends only its actual payload (NUL-terminated strings
// shorter than the buffer, etc.); `decodePadded` zero-pads up to the
// codec's size so trailing-NUL fields still decode correctly.
export async function readCmd<T>(
  t: DspTransport, c: ReadCmd<T>, wValue = 0,
): Promise<T> {
  return decodePadded(c.codec, await t.ctrlIn(c.code, wValue, sizeOf(c.codec)));
}

// Write a fixed-size payload via a `WriteCmd<T>` descriptor
export async function writeCmd<T>(
  t: DspTransport, c: WriteCmd<T>, value: T, wValue = 0,
): Promise<void> {
  await t.ctrlOut(c.code, wValue, encode(c.codec, value));
}
