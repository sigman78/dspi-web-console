// Wire-format codec schemas mirroring docs/bulk_params.h.
//
// Every export is intended to be consumed via a namespace import:
//
//   import * as Wire from './wireTypes';
//   Wire.Header.write(w, {...});
//   Wire.Const.NUM_CHANNELS;
//   Wire.BulkLimits.MaxRequestSize;
//
// The C struct names are mirrored exactly except for the redundant
// `Wire` prefix -- the namespace `Wire` already supplies it.  So
// firmware's `WireHeader` <-> `Wire.Header`, `WireBandParams` <->
// `Wire.BandParams`, and so on.
//
// Layout summary (V6, total 2896 bytes):
//   off    bytes  C struct                    section
//     0      16   WireHeader                  required
//    16      16   WireGlobalParams            required
//    32      16   WireCrossfeedParams         required
//    48      16   WireLegacyChannels          required (ignored)
//    64      44   WireChannelDelays           required
//   108     144   WireCrosspoint  x 2 x 9     required
//   252     108   WireOutputChannel x 9       required
//   360       8   WirePinConfig               required
//   368    2112   WireBandParams x 11 x 12    required
//  2480     352   WireChannelNames            required
//  2832      16   WireI2SConfig               V3+, optional
//  2848      16   WireLevellerConfig          V4+, optional
//  2864      16   WirePreampConfig            V6+, optional
//  2880      16   WireMasterVolume            V6+, optional

import { Codec, type BinCodec } from '../utils';

const { u8, u16, f32, bool8, arr, nulStr, reserved, sizeOf, struct } = Codec;

// Wire-format dimensions (sized to the largest platform: RP2350).
// Names mirror the WIRE_* macros in bulk_params.h. SERIAL_LEN comes
// from the vendor protocol's GetSerial payload size (32 bytes).
export const Const = {
  NUM_CHANNELS:        11,  // WIRE_MAX_CHANNELS
  NUM_OUTPUTS:          9,  // WIRE_MAX_OUTPUT_CHANNELS
  NUM_INPUTS:           2,  // WIRE_MAX_INPUT_CHANNELS
  BANDS_MAX:           12,  // WIRE_MAX_BANDS
  NUM_PIN_OUTPUTS:      5,  // WIRE_MAX_PIN_OUTPUTS
  CHANNEL_NAME_LEN:    32,  // WIRE_NAME_LEN
  NUM_SPDIF_INSTANCES:  4,  // WIRE_MAX_SPDIF_INSTANCES
  SERIAL_LEN:          32,  // GetSerial response length
} as const;

// Section 1: header (16 B)
export const Header = struct({
  formatVersion:    u8,
  platformId:       u8,
  numCh:            u8,
  numOut:           u8,
  numIn:            u8,
  maxBands:         u8,
  _payloadLength:   reserved(2),
  _fwVersionMajor:  reserved(2),
  _fwVersionMinor:  reserved(2),
  _reserved:        reserved(4),
});

// Section 2: global params (16 B)
export const GlobalParams = struct({
  preampDb:             f32,
  bypass:               bool8,
  loudnessEnabled:      bool8,
  _pad:                 reserved(2),
  loudnessRefSpl:       f32,
  loudnessIntensityPct: f32,
});

// Section 3: crossfeed (16 B)
export const CrossfeedParams = struct({
  enabled:    bool8,
  preset:     u8,
  itd:        bool8,
  _pad:       reserved(1),
  freq:       f32,
  feedDb:     f32,
  _reserved2: reserved(4),
});

// Section 4: legacy gain/mute (16 B, ignored on read; zero on write)
export const LegacyChannels: BinCodec<undefined> = reserved(16);

// Section 5: per-channel delays (44 B)
export const ChannelDelays = arr(f32, Const.NUM_CHANNELS);

// Section 6: matrix crosspoint (8 B)
export const Crosspoint = struct({
  enabled: bool8,
  invert:  bool8,
  _pad:    reserved(2),
  gainDb:  f32,
});

// Section 7: matrix output channel (12 B)
export const OutputChannel = struct({
  enabled: bool8,
  muted:   bool8,
  _pad:    reserved(2),
  gainDb:  f32,
  delayMs: f32,
});

// Section 8: pin config (8 B)
export const PinConfig = struct({
  numPinOutputs: u8,
  pins:          arr(u8, Const.NUM_PIN_OUTPUTS),
  _pad:          reserved(2),
});

// Section 9: EQ band parameters (16 B)
export const BandParams = struct({
  type:      u8,
  _pad:      reserved(3),
  frequency: f32,
  q:         f32,
  gain:      f32,
});

// Section 10: channel names (352 B)
export const ChannelNames = arr(nulStr(Const.CHANNEL_NAME_LEN), Const.NUM_CHANNELS);

// Section 11: I2S config (16 B, V3+, optional)
export const I2SConfig = struct({
  outputSlotTypes:      arr(u8, Const.NUM_SPDIF_INSTANCES),
  bckPin:               u8,
  mckPin:               u8,
  mckEnabled:           bool8,
  mckMultiplierEncoded: u8,
  _reserved:            reserved(8),
});

// Section 12: leveller (16 B, V4+, optional)
export const LevellerConfig = struct({
  enabled:   bool8,
  speed:     u8,
  lookahead: bool8,
  _pad:      reserved(1),
  amount:    f32,
  maxGainDb: f32,
  gateDb:    f32,
});

// Section 13: per-channel preamp (V6+, optional).
// The C `WirePreampConfig` is 16 B (8 B data + 8 B reserved padding).
// The TS codec models only the 8-byte data portion: real packets in the
// wild can terminate after the data without the trailing padding, and
// the parser/writer gates on the data-portion length to mirror v1.
export const PreampConfig = struct({
  preampDb: arr(f32, Const.NUM_INPUTS),
});

// Section 14: master volume (V6+, optional).
// The C `WireMasterVolume` is 16 B (4 B data + 12 B reserved). As with
// PreampConfig the TS codec models only the data portion.
export const MasterVolume = struct({
  masterVolumeDb: f32,
});

// Other vendor-control packets.
// These don't appear in `bulk_params.h` because they're not part of the
// bulk transfer; they're standalone control-transfer payloads.

// 8-byte payload of `SetMatrixRoute` / response of `GetMatrixRoute`
// (vendor requests 0x70 / 0x71). Mirrors `MatrixRoutePacket` in
// docs/mixer.md. Field names are camelCased to match domain shapes.
export const MatrixRoutePacket = struct({
  input:       u8,
  output:      u8,
  enabled:     bool8,
  phaseInvert: bool8,
  gainDb:      f32,
});

// 16-byte payload of `SetEqParam` (vendor request 0x43):
//   u8 channel, u8 band, u8 type, u8 _reserved, f32 freq, f32 q, f32 gain.
// Mirrors `EncodeSetFilter` in `DSPiConsole.Usb/DspDevice.cs`.
export const SetFilterPacket = struct({
  channel:   u8,
  band:      u8,
  type:      u8,
  _pad:      reserved(1),
  frequency: f32,
  q:         f32,
  gain:      f32,
});

// 8-byte SPDIF DMA consumer stats (one entry inside `BufferStats`).
// Six u8 metrics + 2 reserved bytes for forward compatibility.
export const SpdifBufferStats = struct({
  consumerFree:       u8,
  consumerPrepared:   u8,
  consumerPlaying:    u8,
  consumerFillPct:    u8,
  consumerMinFillPct: u8,
  consumerMaxFillPct: u8,
  _reserved:          reserved(2),
});

// 8-byte PDM DMA + ring stats (one entry inside `BufferStats`).
// Six u8 metrics + 2 reserved bytes.
export const PdmBufferStats = struct({
  dmaFillPct:    u8,
  dmaMinFillPct: u8,
  dmaMaxFillPct: u8,
  ringFillPct:   u8,
  ringMinFillPct: u8,
  ringMaxFillPct: u8,
  _reserved:     reserved(2),
});

// 44-byte buffer-stats packet returned by `GetBufferStats` (0xB0).
// `flags` low bits: bit0 = pdmActive, bit1 = streaming.
export const BufferStats = struct({
  numSpdif: u8,
  flags:    u8,
  sequence: u16,
  spdif:    arr(SpdifBufferStats, Const.NUM_SPDIF_INSTANCES),
  pdm:      PdmBufferStats,
});

// 32-byte `GetSerial` response: NUL-terminated UTF-8 inside a fixed
// 32-byte window.
export const Serial = nulStr(Const.SERIAL_LEN);

// 32-byte NUL-terminated UTF-8 channel name. Used by SetChannelName
// (0x9B) / GetChannelName (0x9C). Same shape as Serial; aliased for
// readability at call sites.
export const ChannelName = nulStr(Const.CHANNEL_NAME_LEN);

// 4-byte `GetPlatform` response: platform id, firmware major, then a
// packed minor/patch byte (high nibble = minor, low nibble = patch),
// followed by one reserved byte. Firmware insists on sending the full
// 4-byte payload; requesting fewer bytes fails the control-IN transfer.
export const DeviceInfo = struct({
  platformId:   u8,
  fwMajor:      u8,
  fwMinorPatch: u8,
  _reserved:    reserved(1),
});

// Parametric `GetStatus` (0x50) wire schema: the peak count varies by
// platform (7 on RP2040, 11 on RP2350). Other fields are fixed.
// Returns a fresh struct codec for the requested channel count; use
// through `encode` / `decode` like any other codec.
export function SystemStatus(numCh: number) {
  return struct({
    peaks:     arr(u16, numCh),
    cpu0:      u8,
    cpu1:      u8,
    clipFlags: u16,
  });
}

// `GetStatus` (0x50) wValue dispatch. Each code returns a small fixed
// payload (u32 / i32 / 12-byte combined) -- see docs/system-status-req.md.
// The base codec is `Codec.u32` / `Codec.i32`; this enum exists so call
// sites can name the request instead of magic numbers.
export const SystemStatusValue = {
  // Already wired (combined peaks + cpu) -- used by parseSystemStatus().
  CombinedPeaks:        9,

  // PDM error counters (u32 each)
  PdmRingOverruns:      3,
  PdmRingUnderruns:     4,
  PdmDmaOverruns:       5,
  PdmDmaUnderruns:      6,

  // SPDIF error counters (u32 each)
  SpdifOverruns:        7,
  SpdifUnderruns:       8,

  // Environment scalars
  ClockHz:             13,  // u32
  CoreVoltageMv:       14,  // u32 (millivolts)
  SampleRateHz:        15,  // u32
  TempCDegC:           16,  // i32 (centi-C)

  // SPDIF DMA starvations
  SpdifStarvationsTotal: 17, // u32

  // TODO(system-info-extra): not yet wired
  // 10..12 (USB packets / alt setting / mounted),
  // 18..21 (per-slot SPDIF starvations).
} as const;
export type SystemStatusValue = (typeof SystemStatusValue)[keyof typeof SystemStatusValue];

// Bulk packet sizing.
// Min size = the V2-mandatory prefix (everything up through channel names).
// Max size = min + V6 trailing sections (I2S, leveller, preamp, master
// volume) at their full 16-byte aligned width. The V6 codecs describe
// only the data portion; firmware pads each section to 16 bytes, which
// V6_TAIL_SIZE below accounts for so the parser stays magic-free.

const FIXED_PREFIX_SIZE =
  sizeOf(Header) +
  sizeOf(GlobalParams) +
  sizeOf(CrossfeedParams) +
  sizeOf(LegacyChannels) +
  sizeOf(ChannelDelays) +
  sizeOf(Crosspoint) * (Const.NUM_INPUTS * Const.NUM_OUTPUTS) +
  sizeOf(OutputChannel) * Const.NUM_OUTPUTS +
  sizeOf(PinConfig) +
  sizeOf(BandParams) * (Const.NUM_CHANNELS * Const.BANDS_MAX) +
  sizeOf(ChannelNames);  // = 2832

// Each V6 section in the firmware struct is 16-byte aligned regardless
// of how many bytes its data portion occupies. Four sections x 16 = 64.
const V6_TAIL_SIZE = 4 * 16;

export const BulkLimits = {
  MinPacketSize:  FIXED_PREFIX_SIZE,                  // 2832
  MaxRequestSize: FIXED_PREFIX_SIZE + V6_TAIL_SIZE,   // 2896
} as const;

// Absolute offsets of the V6 trailing sections.
// Used by the parser (`r.seek(...)`) and synthesizer (`w.seek(...)`). They
// derive from `BulkLimits` plus section codec sizes; `MasterVolume` is
// the one place firmware reserved padding diverges from the codec's
// data-only size, so we express it as `MaxRequestSize - 16` (the
// master-vol section's full 16-B footprint).

export const BulkOffsets = {
  I2S:          BulkLimits.MinPacketSize,                                          // 2832
  Leveller:     BulkLimits.MinPacketSize + sizeOf(I2SConfig),                      // 2848
  PerChPreamp:  BulkLimits.MinPacketSize + sizeOf(I2SConfig) + sizeOf(LevellerConfig), // 2864
  MasterVolume: BulkLimits.MaxRequestSize - 16,                                    // 2880
} as const;

// Preset startup mode (authoritative; mirrors firmware preset.h):
//   #define PRESET_STARTUP_SPECIFIED   0   // Load a specific default slot
//   #define PRESET_STARTUP_LAST_ACTIVE 1   // Load whichever slot was last active
// Only these two values are defined by firmware. Tolerated bytes outside
// {0,1} surface as `number` so callers don't get silently mis-typed enum
// values during a firmware divergence.
export const PresetStartupMode = {
  Specified:  0,
  LastActive: 1,
} as const;
export type PresetStartupMode = (typeof PresetStartupMode)[keyof typeof PresetStartupMode];

// Preset directory packet (response to GetPresetDir 0x95). Schema is the
// V12+ 7-byte shape; legacy firmware truncates to 6 bytes (no trailing
// masterVolumeMode byte) and `decodePadded` zero-extends — masterVolumeMode
// reads as 0, the correct legacy semantic ("independent" mode), not a
// sentinel. Always request 7 bytes from the device: WinUSB treats
// device-overrun as a babble error and fails the transfer.
//
// The consumer-facing shape lives in `domain/presetDirectory.ts`; this
// codec stays raw (u8/u16/bool8) and is only consumed by DspDevice.
export const PresetDirectory = struct({
  occupiedMask:     u16,
  startupMode:      u8,
  defaultSlot:      u8,
  lastActiveSlot:   u8,
  includePins:      bool8,
  masterVolumeMode: u8,
});

export const PresetDirRequestSize = sizeOf(PresetDirectory); // 7

// 2-byte payload of PresetSetStartup (0x96) / response of PresetGetStartup
// (0x97). The same {mode, defaultSlot} pair surfaces inside the directory
// packet via GetPresetDir; this codec exists so call sites that only want
// the startup config can target it directly.
export const PresetStartupConfig = struct({
  mode: u8,
  slot: u8,
});
