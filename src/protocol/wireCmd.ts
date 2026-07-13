// Vendor-control command codes (`bRequest` of the USB control transfer).
//
// Each entry carries its `code` and, where the payload is a single fixed-size
// codec, the `codec` for encode/decode (consumed by readCmd / writeCmd below).
// Entries without a `codec` use bit-packed wValues, variable-length payloads,
// or are host-side unimplemented.

import type { DspTransport } from '@/transport/DspTransport';
import { type BinCodec, Codec } from '@/utils';
import * as Wire from './wireTypes';
import type {
  ChannelId, InputSlot, OutputSlot, FilterType, MasterVolumeMode, OutputConfigMode,
  AudioInputSource, LgSoundSync, DacHwMute,
} from '@/domain';

// Descriptor types

export interface ReadCmd<T>  { readonly code: number; readonly codec: BinCodec<T> }
export interface WriteCmd<T> { readonly code: number; readonly codec: BinCodec<T> }
export interface RawCmd      { readonly code: number }

// Re-type a wire codec to a narrower API-level shape (ChannelId, FilterType,
// ...) at the type level only; the runtime codec is unchanged. Needed because
// BinCodec<T> is invariant in T, so a direct assignment is rejected.
function tighten<T>(codec: BinCodec<unknown>): BinCodec<T> {
  return codec as BinCodec<T>;
}

// Payload shapes for codec-carrying commands.
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
type CsBindingPayload = {
  type: number; noun: number; action: number; flags: number;
  gpio0: number; gpio1: number; event: number; target: number; index: number;
  value: number; step: number; rangeMin: number; rangeMax: number;
};
type CsStatusPayload = {
  lastStatus: number; lastSlot: number; maxBindings: number; dirty: boolean;
  activeMask: number; slotStatus: number[];
  irActiveMask: number; irLearnState: number; irCmdStatus: number[];
};
type CsIrCommandPayload = {
  noun: number; action: number; flags: number; target: number; index: number;
  protocol: number; value: number; step: number; code: number;
};
type LevellerMasksPayload = { detector: number; apply: number };

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
  // currently-active slot. See docs/HW-PROFILES.md sec 2.
  SaveParams:           { code: 0x51 } satisfies RawCmd,
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
  SetAllParams:         { code: 0xA1 } satisfies RawCmd,
  // Chunked bulk access (fw 1.1.5+, V16 only): wValue = byte offset, chunks
  // <= 4096 B. A session is torn down by any interleaved non-chunk vendor
  // request; see DspDevice.getAllParams/setAllParams.
  GetAllParamsChunk:    { code: 0xA2 } satisfies RawCmd,
  SetAllParamsChunk:    { code: 0xA3 } satisfies RawCmd,

  // Output pin assignment (0x7C/0x7D) and I2S output config (0xC0-0xC9).
  // All are action-style IN: args in wValue, response is 1-byte status/value.
  // See docs/PINS-CONFIG.md.
  SetOutputPin:         { code: 0x7C } satisfies RawCmd,
  GetOutputPin:         { code: 0x7D } satisfies RawCmd,
  SetOutputType:        { code: 0xC0 } satisfies RawCmd,
  GetOutputType:        { code: 0xC1 } satisfies RawCmd,
  // Role-indexed (fw V21+): SET wValue = (role<<8)|GPIO, GET wValue = role.
  // role 0 = master/unified pair (legacy encoding, byte-identical to pre-V21);
  // role 1 = slave pair. See DspDevice.setI2sBckPin/getI2sBckPin.
  SetI2sBckPin:         { code: 0xC2 } satisfies RawCmd,
  GetI2sBckPin:         { code: 0xC3 } satisfies RawCmd,
  SetMckEnable:         { code: 0xC4 } satisfies RawCmd,
  GetMckEnable:         { code: 0xC5 } satisfies RawCmd,
  SetMckPin:            { code: 0xC6 } satisfies RawCmd,
  GetMckPin:            { code: 0xC7 } satisfies RawCmd,
  SetMckMultiplier:     { code: 0xC8 } satisfies RawCmd,
  GetMckMultiplier:     { code: 0xC9 } satisfies RawCmd,

  GetBufferStats:       { code: 0xB0 } satisfies RawCmd,
  ResetBufferStats:     { code: 0xB1 } satisfies RawCmd,

  // Presets (0x90..0x9A). See docs/HW-PROFILES.md sec 1b.
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
  // Output-config persistence mode (1.1.4 semantics; legacy include-pins bool
  // on older firmware, values 1:1). Deliberately ungated: the opcode exists
  // and is value-compatible across the whole support window.
  SetOutputConfigMode:  { code: 0x98, codec: tighten<OutputConfigMode>(Codec.u8) } satisfies WriteCmd<OutputConfigMode>,
  GetOutputConfigMode:  { code: 0x99, codec: tighten<OutputConfigMode>(Codec.u8) } satisfies ReadCmd<OutputConfigMode>,
  PresetGetActive:      { code: 0x9A } satisfies RawCmd,

  // Loudness (V4+) -- firmware feature, deferred
  SetLoudnessEnabled:    { code: 0x58, codec: Codec.bool8 } satisfies WriteCmd<boolean>,
  SetLoudnessRefSpl:     { code: 0x5A, codec: Codec.f32 }   satisfies WriteCmd<number>,
  SetLoudnessIntensity:  { code: 0x5C, codec: Codec.f32 }   satisfies WriteCmd<number>,
  // Per-output loudness mask (V19+): payload = u16 LE, bit k = output channel k.
  SetLoudnessMask:       { code: 0xFA, codec: Codec.u16 }   satisfies WriteCmd<number>,
  GetLoudnessMask:       { code: 0xFB, codec: Codec.u16 }   satisfies ReadCmd<number>,

  // Crossfeed (V4+) -- firmware feature, deferred. Fields land in firmware order:
  // enable, preset, freq, feed, ITD. Even codes are SET, odd codes are GET.
  SetCrossfeedEnabled:   { code: 0x5E, codec: Codec.bool8 } satisfies WriteCmd<boolean>,
  SetCrossfeedPreset:    { code: 0x60, codec: Codec.u8 }    satisfies WriteCmd<number>,
  SetCrossfeedFreq:      { code: 0x62, codec: Codec.f32 }   satisfies WriteCmd<number>,
  SetCrossfeedFeedDb:    { code: 0x64, codec: Codec.f32 }   satisfies WriteCmd<number>,
  SetCrossfeedItd:       { code: 0x66, codec: Codec.bool8 } satisfies WriteCmd<boolean>,
  // Crossfeed output-pair mask (V20+): payload = u8, bit p = output pair p
  // (outputs 2p/2p+1; the mono PDM sub is excluded).
  SetCrossfeedOutputs:   { code: 0xFC, codec: Codec.u8 }    satisfies WriteCmd<number>,
  GetCrossfeedOutputs:   { code: 0xFD, codec: Codec.u8 }    satisfies ReadCmd<number>,

  // Volume Leveller (V4+) -- firmware feature, deferred. Fields land in firmware
  // order: enable, amount, speed, max gain, lookahead, gate.
  SetLevellerEnabled:    { code: 0xB4, codec: Codec.bool8 } satisfies WriteCmd<boolean>,
  SetLevellerAmount:     { code: 0xB6, codec: Codec.f32 }   satisfies WriteCmd<number>,
  SetLevellerSpeed:      { code: 0xB8, codec: Codec.u8 }    satisfies WriteCmd<number>,
  SetLevellerMaxGain:    { code: 0xBA, codec: Codec.f32 }   satisfies WriteCmd<number>,
  SetLevellerLookahead:  { code: 0xBC, codec: Codec.bool8 } satisfies WriteCmd<boolean>,
  SetLevellerGate:       { code: 0xBE, codec: Codec.f32 }   satisfies WriteCmd<number>,
  // Multichannel leveller masks (V18+): payload = [detector_mask, apply_mask].
  SetLevellerMasks:      { code: 0xDE, codec: Wire.LevellerMasks } satisfies WriteCmd<LevellerMasksPayload>,
  GetLevellerMasks:      { code: 0xDF, codec: Wire.LevellerMasks } satisfies ReadCmd<LevellerMasksPayload>,

  // --- v1.1.4 / working_spdif_input granular surface (docs/HW-DSPUSB.md) ---
  // Per-band EQ bypass: wValue = (channel<<8)|band, 1-byte body.
  SetBandBypass:         { code: 0xD8, codec: Codec.bool8 } satisfies WriteCmd<boolean>,
  GetBandBypass:         { code: 0xD9, codec: Codec.bool8 } satisfies ReadCmd<boolean>,
  SetUserVolume:         { code: 0xDA, codec: Codec.f32 }   satisfies WriteCmd<number>,
  GetUserVolume:         { code: 0xDB, codec: Codec.f32 }   satisfies ReadCmd<number>,
  SetUserMute:           { code: 0xDC, codec: Codec.bool8 } satisfies WriteCmd<boolean>,
  GetUserMute:           { code: 0xDD, codec: Codec.bool8 } satisfies ReadCmd<boolean>,
  SetInputSource:        { code: 0xE0, codec: tighten<AudioInputSource>(Codec.u8) } satisfies WriteCmd<AudioInputSource>,
  GetInputSource:        { code: 0xE1, codec: tighten<AudioInputSource>(Codec.u8) } satisfies ReadCmd<AudioInputSource>,
  // Live status reads (no bulk equivalent).
  GetSpdifRxStatus:      { code: 0xE2, codec: Wire.SpdifRxStatus },
  GetSpdifRxChStatus:    { code: 0xE3 } satisfies RawCmd,
  // S/PDIF RX pin: wValue = GPIO on set; status byte on get.
  SetSpdifRxPin:         { code: 0xE4 } satisfies RawCmd,
  GetSpdifRxPin:         { code: 0xE5, codec: Codec.u8 } satisfies ReadCmd<number>,
  // Multi-SPDIF input enable (fw 1.1.5+): one physical receiver fanned out
  // over up to 3 selectable GPIOs. Set is action-IN with
  // wValue = (index<<8)|enable (index 1..2), 1-byte PinConfigResult; Get
  // returns [count, enableMask, pin0, pin1, pin2] (enableMask unshifted).
  SetSpdifInputEnable:   { code: 0xE9 } satisfies RawCmd,
  GetSpdifInputConfig:   { code: 0xEF, codec: Wire.SpdifInputConfig } satisfies ReadCmd<{ count: number; enableMask: number; pins: number[] }>,
  SetLgSoundSyncEnabled: { code: 0xE6, codec: Codec.bool8 } satisfies WriteCmd<boolean>,
  GetLgSoundSyncEnabled: { code: 0xE7, codec: Codec.bool8 } satisfies ReadCmd<boolean>,
  GetLgSoundSyncStatus:  { code: 0xE8, codec: tighten<LgSoundSync>(Wire.LgSoundSync) } satisfies ReadCmd<LgSoundSync>,
  SetDacHwMute:          { code: 0xEA, codec: tighten<DacHwMute>(Wire.DacHwMute) } satisfies WriteCmd<DacHwMute>,
  GetDacHwMute:          { code: 0xEB, codec: tighten<DacHwMute>(Wire.DacHwMute) } satisfies ReadCmd<DacHwMute>,
  TestDacHwMute:         { code: 0xEC } satisfies RawCmd,
  // Persist live output config (pins, output types, I2S BCK/MCK, S/PDIF RX
  // pin) to the preset directory's device-global block. Action-IN, 1-byte
  // PresetResult. Repurposes legacy 0x52 (the removed sync LoadParams);
  // V10+ only — on older firmware the opcode is a synchronous revert-to-saved.
  SaveOutputConfig:      { code: 0x52 } satisfies RawCmd,

  // M8 — System command: reboot into UF2 bootloader (BOOTSEL).
  // Action-IN; firmware sends 1-byte success (0x01) then calls reset_usb_boot().
  // The device disconnects ~100 ms after the response, so the transfer may
  // throw. Callers must treat both a clean return and a throw as expected.
  EnterBootloader:       { code: 0xF0 } satisfies RawCmd,

  // --- V16 / fw 1.1.5 I2S-input surface ---
  // The device is the rate authority while I2S input is active, so the rate
  // is a command, not a detection. Set: u32 Hz payload (44100/48000/96000).
  // Get: 8-byte response {current pipeline Hz, selected I2S Hz}.
  SetInputRate:          { code: 0xED, codec: Codec.u32 } satisfies WriteCmd<number>,
  GetInputRate:          { code: 0xEE } satisfies RawCmd,
  // I2S RX data pin per stereo pair. Set is action-IN with
  // wValue = (pair << 8) | GPIO, 1-byte PinConfigResult; Get takes the pair
  // in wValue and returns that pair's GPIO.
  SetI2sRxPin:           { code: 0xF1 } satisfies RawCmd,
  GetI2sRxPin:           { code: 0xF2, codec: Codec.u8 } satisfies ReadCmd<number>,
  // Active I2S input channel count (2/4/6/8; RP2350 multichannel). Set is
  // action-IN with the count in wValue, 1-byte PinConfigResult.
  SetI2sInputChannels:   { code: 0xF3 } satisfies RawCmd,
  GetI2sInputChannels:   { code: 0xF4, codec: Codec.u8 } satisfies ReadCmd<number>,

  // --- V21 / fw 1.1.5 I2S slave-clock mode ---
  // Clock role: payload u8, 0 = master, 1 = slave. Deferred apply -- firmware
  // applies from the main loop, so GET doesn't reflect a just-sent SET
  // immediately.
  SetI2sClockMode:       { code: 0x88, codec: Codec.u8 } satisfies WriteCmd<number>,
  GetI2sClockMode:       { code: 0x89, codec: Codec.u8 } satisfies ReadCmd<number>,
  // Live slave-clock lock status (no bulk equivalent).
  GetI2sSlaveStatus:     { code: 0x8A, codec: Wire.I2sSlaveStatus },
  // BCK/LRCLK pin-sharing mode: wValue = 0 unified / 1 split, 1-byte
  // PinConfigResult (same convention as SetI2sBckPin below).
  SetI2sClockPinMode:    { code: 0xFE } satisfies RawCmd,
  GetI2sClockPinMode:    { code: 0xFF } satisfies RawCmd,

  // --- V23 psychoacoustic bass (fw 1.1.5+, RP2350). Opcodes only -- no
  // DspDevice methods yet; wiring lands with the psybass UI branch.
  SetPsybassEnabled:     { code: 0x30, codec: Codec.bool8 } satisfies WriteCmd<boolean>,
  GetPsybassEnabled:     { code: 0x31, codec: Codec.bool8 } satisfies ReadCmd<boolean>,
  SetPsybassCutoff:      { code: 0x32, codec: Codec.f32 }   satisfies WriteCmd<number>,
  GetPsybassCutoff:      { code: 0x33, codec: Codec.f32 }   satisfies ReadCmd<number>,
  SetPsybassHarmonics:   { code: 0x34, codec: Codec.f32 }   satisfies WriteCmd<number>,
  GetPsybassHarmonics:   { code: 0x35, codec: Codec.f32 }   satisfies ReadCmd<number>,
  SetPsybassDrive:       { code: 0x36, codec: Codec.f32 }   satisfies WriteCmd<number>,
  GetPsybassDrive:       { code: 0x37, codec: Codec.f32 }   satisfies ReadCmd<number>,
  SetPsybassCharacter:   { code: 0x38, codec: Codec.f32 }   satisfies WriteCmd<number>,
  GetPsybassCharacter:   { code: 0x39, codec: Codec.f32 }   satisfies ReadCmd<number>,
  SetPsybassOriginal:    { code: 0x3A, codec: Codec.f32 }   satisfies WriteCmd<number>,
  GetPsybassOriginal:    { code: 0x3B, codec: Codec.f32 }   satisfies ReadCmd<number>,
  SetPsybassMask:        { code: 0x3C, codec: Codec.u16 }   satisfies WriteCmd<number>,
  GetPsybassMask:        { code: 0x3D, codec: Codec.u16 }   satisfies ReadCmd<number>,

  // --- V24 ADAT input config (fw 1.1.5+, RP2350). Opcodes only -- no
  // DspDevice methods yet; wiring lands with the ADAT input UI branch.
  SetAdatInputEnable:    { code: 0x68, codec: Codec.bool8 } satisfies WriteCmd<boolean>,
  GetAdatInputEnable:    { code: 0x69, codec: Codec.bool8 } satisfies ReadCmd<boolean>,
  SetAdatInputPin:       { code: 0x6A, codec: Codec.u8 }    satisfies WriteCmd<number>,
  GetAdatInputPin:       { code: 0x6B, codec: Codec.u8 }    satisfies ReadCmd<number>,
  SetAdatInputClockMode: { code: 0x6C, codec: Codec.u8 }    satisfies WriteCmd<number>,
  GetAdatInputClockMode: { code: 0x6D, codec: Codec.u8 }    satisfies ReadCmd<number>,
  GetAdatInputStatus:    { code: 0x6E } satisfies RawCmd,

  // --- V16 / fw 1.1.5 external control interfaces (UART + I2C) ---
  // SETs are plain control-OUT with the struct payload; the firmware refuses
  // them over UART/I2C itself (USB-only), which is moot here since the
  // console always speaks USB. The result of a SET is read back from
  // GetCtrlIfaceStatus's matching last_status field; see DspDevice.
  SetUartConfig:         { code: 0xF5, codec: Wire.UartCtrlConfig } satisfies WriteCmd<{ enabled: boolean; txPin: number; rxPin: number; notifyEnable: boolean; baud: number }>,
  GetUartConfig:         { code: 0xF6, codec: Wire.UartCtrlConfig } satisfies ReadCmd<{ enabled: boolean; txPin: number; rxPin: number; notifyEnable: boolean; baud: number }>,
  SetI2cConfig:          { code: 0xF7, codec: Wire.I2cCtrlConfig } satisfies WriteCmd<{ enabled: boolean; sdaPin: number; sclPin: number; address: number }>,
  GetI2cConfig:          { code: 0xF8, codec: Wire.I2cCtrlConfig } satisfies ReadCmd<{ enabled: boolean; sdaPin: number; sclPin: number; address: number }>,
  GetCtrlIfaceStatus:    { code: 0xF9, codec: Wire.CtrlIfaceStatus } satisfies ReadCmd<{ uartLastStatus: number; uartLive: boolean; i2cLastStatus: number; i2cLive: boolean; protoVersion: number }>,

  // --- V16 / fw 1.1.5 Control Surfaces (0x84-0x87, 0x8B-0x8C, 0x9D-0x9E) ---
  // SetCsBinding is a control-OUT (wValue = slot) with NO response: firmware
  // latches the binding and applies it from the main loop, so the outcome is
  // learned by polling GetCsStatus until last_status leaves PENDING (see
  // DspDevice.setCsBinding). GetCsCaps stays raw: wValue 0xFFFF returns the
  // capsVersion/typeCount-driven header + type table (parsed dynamically in
  // DspDevice), a noun index its 12-byte descriptor.
  SetCsBinding:          { code: 0x84, codec: Wire.CsBinding } satisfies WriteCmd<CsBindingPayload>,
  GetCsBinding:          { code: 0x85, codec: Wire.CsBinding } satisfies ReadCmd<CsBindingPayload>,
  GetCsCaps:             { code: 0x86 } satisfies RawCmd,
  GetCsStatus:           { code: 0x87, codec: Wire.CsStatusPacket } satisfies ReadCmd<CsStatusPayload>,
  // Slot name SET/GET: same live-only-preview semantics as SetCsBinding,
  // polled the same way.
  SetCsName:             { code: 0x8B, codec: Wire.CsName } satisfies WriteCmd<string>,
  GetCsName:             { code: 0x8C, codec: Wire.CsName } satisfies ReadCmd<string>,
  // IR command sub-slots: same deferred SET model as SetCsBinding, reported
  // in last_slot as 0x80 | sub-slot. GetCsIrCmd is a plain live read.
  SetCsIrCmd:            { code: 0x8D, codec: Wire.CsIrCommand } satisfies WriteCmd<CsIrCommandPayload>,
  GetCsIrCmd:            { code: 0x8E, codec: Wire.CsIrCommand } satisfies ReadCmd<CsIrCommandPayload>,
  // GET-type action command (wValue 1 = arm, 0 = cancel, 2 = read result),
  // in the mold of CsSave/CsRevert below. Arm/cancel return a 1-byte ack;
  // the result read returns the 8-byte CsIrLearnResult instead, so this
  // stays a RawCmd and DspDevice decodes each response shape itself.
  CsIrLearn:             { code: 0x8F } satisfies RawCmd,
  // Persist / discard the live CS preview (bindings + names). Action-style
  // IN: 1-byte accept/reject, real result via GetCsStatus (last_slot 0xFF).
  CsSave:                { code: 0x9D } satisfies RawCmd,
  CsRevert:              { code: 0x9E } satisfies RawCmd,
} as const;

// Helpers

// Read a fixed-size payload via a `ReadCmd<T>` descriptor. Control-IN may
// return fewer bytes than requested (short NUL-terminated strings, etc.), so
// `decodePadded` zero-pads to the codec's size before decoding.
export async function readCmd<T>(
  t: DspTransport, c: ReadCmd<T>, wValue = 0,
): Promise<T> {
  return Codec.decodePadded(c.codec, await t.ctrlIn(c.code, wValue, Codec.sizeOf(c.codec)));
}

// Write a fixed-size payload via a `WriteCmd<T>` descriptor
export async function writeCmd<T>(
  t: DspTransport, c: WriteCmd<T>, value: T, wValue = 0,
): Promise<void> {
  await t.ctrlOut(c.code, wValue, Codec.encode(c.codec, value));
}

// Action-style IN: control-IN that the firmware uses to *trigger* a side
// effect and return a 1-byte status code. Returns 0xFF if the response
// is empty (transport-level failure short of a throw). The raw byte is
// decoded into a typed Result by the helpers in results.ts.
export async function actionCmd(
  t: DspTransport,
  cmd: { code: number },
  wValue = 0,
): Promise<number> {
  const r = await t.ctrlIn(cmd.code, wValue, 1);
  return r.length >= 1 ? r[0] : 0xFF;
}
