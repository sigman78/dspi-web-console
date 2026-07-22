// Wire-format codec schemas, consumed via `import * as Wire from './wireTypes'`.
// C struct names are mirrored minus the redundant `Wire` prefix (the namespace
// supplies it): firmware `WireBandParams` <-> `Wire.BandParams`.
//
// Layout summary (V10, total 2960 bytes):
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
//  2896      16   WireInputConfig             V7+, optional
//  2912      16   WireLgSoundSync             V8+, optional
//  2928      16   WireUserVolume              V9+, optional
//  2944      16   WireDacHwMute               V10+, optional

import { Codec, type BinCodec } from '@/utils';

const { u8, i8, u16, u32, i16, f32, bool8, arr, nulStr, reserved, sizeOf, struct } = Codec;

// Wire-format dimensions, sized to the largest platform (RP2350), per
// channel-model generation. V10 (fw 1.1.4): 2 fixed inputs, 11 channels.
// V16 (fw 1.1.5, unified channel model): 8 inputs, 17 channels, plus the
// crossover section. `Const` keeps the V10 values (it also names the
// generation-invariant dimensions); `Const16` overrides the ones that grew.
export const Const = {
  NUM_CHANNELS:        11,  // WIRE_MAX_CHANNELS (V10)
  NUM_OUTPUTS:          9,  // WIRE_MAX_OUTPUT_CHANNELS
  NUM_INPUTS:           2,  // WIRE_MAX_INPUT_CHANNELS (V10)
  BANDS_MAX:           12,  // WIRE_MAX_BANDS
  NUM_PIN_OUTPUTS:      5,  // WIRE_MAX_PIN_OUTPUTS
  CHANNEL_NAME_LEN:    32,  // WIRE_NAME_LEN
  NUM_SPDIF_INSTANCES:  4,  // WIRE_MAX_SPDIF_INSTANCES
  SERIAL_LEN:          32,  // GetSerial response length
} as const;

export const Const16 = {
  NUM_CHANNELS:        17,  // WIRE_MAX_CHANNELS (V16: 8 in + 9 out)
  NUM_INPUTS:           8,  // WIRE_MAX_INPUT_CHANNELS (V16)
  XOVER_BANDS:          4,  // WIRE_MAX_XOVER_BANDS
} as const;

// Wire array dimensions for a given format version. Versions above the
// known ceiling parse with the newest known shape.
export function dimsForVersion(v: number): { numCh: number; numIn: number } {
  return v >= 16
    ? { numCh: Const16.NUM_CHANNELS, numIn: Const16.NUM_INPUTS }
    : { numCh: Const.NUM_CHANNELS,   numIn: Const.NUM_INPUTS };
}

// Section 1: header (16 B)
export const Header = struct({
  formatVersion:    u8,
  platformId:       u8,
  numCh:            u8,
  numOut:           u8,
  numIn:            u8,
  maxBands:         u8,
  payloadLength:    u16,
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

// Section 2, V19 shape: the reserved pad becomes the per-output loudness mask.
// Bit k = loudness processes output channel k. Same 16-byte size as GlobalParams.
export const GlobalParams19 = struct({
  preampDb:             f32,
  bypass:               bool8,
  loudnessEnabled:      bool8,
  loudnessOutputMask:   u16,
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

// Section 3, V20 shape: the reserved byte becomes the output-pair mask. Bit p =
// crossfeed runs on output pair p (outputs 2p/2p+1); the mono PDM sub is
// excluded. Same 16-byte size as CrossfeedParams.
export const CrossfeedParams20 = struct({
  enabled:         bool8,
  preset:          u8,
  itd:             bool8,
  outputPairMask:  u8,
  freq:            f32,
  feedDb:          f32,
  _reserved2:      reserved(4),
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

// Section 9: EQ band parameters (16 B). Byte 1 was `reserved` through V9;
// V10 firmware reinterprets it as `bypass` (1 = band excluded from the
// response). Decoding it on older firmware is harmless -- it reads 0.
export const BandParams = struct({
  type:      u8,
  bypass:    u8,
  _pad:      reserved(2),
  frequency: f32,
  q:         f32,
  gain:      f32,
});

// Section 9, V22 shape: bytes 2-3 (previously reserved) carry the Linkwitz
// Transform qp sidecar (u16 LE, round(Qp*512); 0 = 0.707 default) when
// type == 11 (LINKWITZ_TRANSFORM); firmware forces it to 0 for every other
// type. Same 16-byte size as BandParams.
export const BandParamsQp = struct({
  type:      u8,
  bypass:    u8,
  qp:        u16,
  frequency: f32,
  q:         f32,
  gain:      f32,
});

// Section 10: channel names (352 B)
export const ChannelNames = arr(nulStr(Const.CHANNEL_NAME_LEN), Const.NUM_CHANNELS);

// Section 11: I2S config (16 B, V3+, optional). clockPinModeP1/bckPinSlave
// (fw V21+ i2s slave-clock pins) claim two of the reserved bytes; NOT
// version-gated -- 0 is the safe absent value on every pre-V21 packet, so one
// codec serves every generation.
export const I2SConfig = struct({
  outputSlotTypes:      arr(u8, Const.NUM_SPDIF_INSTANCES),
  bckPin:               u8,
  mckPin:               u8,
  mckEnabled:           bool8,
  mckMultiplierEncoded: u8,
  clockPinModeP1:       u8,   // 0=absent, 1=unified, 2=split
  bckPinSlave:          u8,   // slave-mode BCK GPIO; LRCLK = +1. 0 = unset
  _reserved:            reserved(6),
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

// Section 12, V18 shape: the 16-byte V4 leveller + detector/apply channel masks
// (+4 B). detectorMask/applyMask: bit k = input channel k. Interior grow, so a
// V18 packet shifts every following section by +4 bytes.
export const LevellerConfig18 = struct({
  enabled:      bool8,
  speed:        u8,
  lookahead:    bool8,
  _pad:         reserved(1),
  amount:       f32,
  maxGainDb:    f32,
  gateDb:       f32,
  detectorMask: u8,
  applyMask:    u8,
  _pad2:        reserved(2),
});

// Live leveller channel masks (fw V18+): payload of REQ_SET/GET_LEVELLER_MASKS
// (0xDE/0xDF), 2 bytes [detector_mask, apply_mask]. Distinct from the bulk
// section above; carried as a standalone command so masks can be edited live.
export const LevellerMasks = struct({
  detector: u8,
  apply:    u8,
});

// Section 13: per-channel preamp (V6+, optional). Full 16-byte on-wire
// footprint: 8 B data + 8 B reserved. Models the full section size so
// sequential reads/writes don't require absolute seeks.
export const PreampConfig = struct({
  preampDb:  arr(f32, Const.NUM_INPUTS),
  _reserved: reserved(8),
});

// Section 13, V16 shape: 8 input preamps, 32 bytes, no reserved pad.
export const PreampConfig16 = struct({
  preampDb: arr(f32, Const16.NUM_INPUTS),
});

// Section 14: master volume (V6+, optional). Full 16-byte on-wire
// footprint: 4 B data + 12 B reserved.
export const MasterVolume = struct({
  masterVolumeDb: f32,
  _reserved:      reserved(12),
});

// Section 15: input config (16 B, V7+, optional). input_source: 0=USB,
// 1=S/PDIF, 2=I2S (V16+). Bytes 2..10 are claimed from the reserved pad with
// a "0 = absent" convention; on an older packet they read as zeros and
// round-trip unchanged, so one codec serves every generation.
export const InputConfig = struct({
  inputSource:          u8,
  spdifRxPin:           u8,
  i2sRxPin:             u8,            // I2S RX data GPIO, stereo pair 0
  i2sInputRate:         u8,            // enum: 0=44100, 1=48000, 2=96000
  i2sInputChannels:     u8,            // active I2S input channels 2/4/6/8 (0 = absent)
  i2sRxPinExt:          arr(u8, 3),    // RX data GPIOs for stereo pairs 1..3 (0 = unset)
  spdifRxPinExt:        arr(u8, 2),    // GPIOs for SPDIF2/3 (fw 1.1.5+; 0 = absent/keep-live)
  spdifRxEnabledExtP1:  u8,            // enable mask + 1; 0 = absent, else (byte-1): bit0=SPDIF2, bit1=SPDIF3
  _reserved:            reserved(5),
});

// Section 15, V21 shape: the first reserved byte becomes the I2S clock role.
// 0 = master (legacy default), 1 = slave. Same 16-byte size as InputConfig.
export const InputConfig21 = struct({
  inputSource:          u8,
  spdifRxPin:           u8,
  i2sRxPin:             u8,
  i2sInputRate:         u8,
  i2sInputChannels:     u8,
  i2sRxPinExt:          arr(u8, 3),
  spdifRxPinExt:        arr(u8, 2),
  spdifRxEnabledExtP1:  u8,
  i2sClockMode:         u8,
  _reserved:            reserved(4),
});

// Section 15, V24 shape: bytes 12-14 (previously reserved) carry the ADAT
// input config -- adat_input_pin (GPIO, 0 = absent/keep-live),
// adat_input_enabled_p1 (0 absent / 1 disabled / 2 enabled), and
// adat_input_clock_mode_p1 (0 absent / 1 master / 2 slave). Same 16-byte
// size as InputConfig21.
export const InputConfig24 = struct({
  inputSource:          u8,
  spdifRxPin:           u8,
  i2sRxPin:             u8,
  i2sInputRate:         u8,
  i2sInputChannels:     u8,
  i2sRxPinExt:          arr(u8, 3),
  spdifRxPinExt:        arr(u8, 2),
  spdifRxEnabledExtP1:  u8,
  i2sClockMode:         u8,
  adatInputPin:         u8,
  adatInputEnabledP1:   u8,
  adatInputClockModeP1: u8,
  _reserved:            reserved(1),
});

// Section 16: LG Sound Sync (16 B, V8+, optional). Only `enabled` is host-
// configurable through bulk apply; present/volume/muted are runtime state.
export const LgSoundSync = struct({
  enabled:   bool8,
  present:   bool8,
  volume:    u8,
  muted:     bool8,
  _reserved: reserved(12),
});

// Section 17: user volume (16 B, V9+, optional). Separate from master-volume.
export const UserVolume = struct({
  volumeDb:  f32,
  mute:      bool8,
  _reserved: reserved(11),
});

// Section 18: DAC hardware mute config (16 B, V10+, optional).
export const DacHwMute = struct({
  enabled:    bool8,
  activeLow:  bool8,
  pin:        u8,
  _reserved0: reserved(1),
  holdMs:     u16,
  releaseMs:  u16,
  _reserved:  reserved(8),
});

// Section 20: ADAT lightpipe output config (8 B, V17+; RP2350 only). enabled/pin
// are persisted intent; pin == 0 means the platform default. Zeroed/ignored on
// RP2040. Appended at the very end of the packet, after the crossover section.
export const AdatConfig = struct({
  enabled:   bool8,
  pin:       u8,
  _reserved: reserved(6),
});

// Section 21: psychoacoustic bass config (24 B, V23+; RP2350 only, but
// structurally present on every V23+ packet). Appended after AdatConfig.
export const PsybassParams = struct({
  enabled:      bool8,
  _reserved0:   reserved(1),
  outputMask:   u16,
  cutoffHz:     f32,
  harmonicsDb:  f32,
  driveDb:      f32,
  characterPct: f32,
  originalDb:   f32,
});

// Section 22: stereo upmixer config (44 B, V25+; RP2350 only, but
// structurally present on every V25+ packet). Appended after PsybassParams.
// Byte 3 (reserved through V25) becomes `presenceQ1` on V26+: int8,
// round(clamp(presenceDb, -12, 12) * 2).
export const UpmixParams = struct({
  enabled:          bool8,
  centerMode:       u8,
  surroundMode:     u8,
  presenceQ1:       i8,
  strengthPct:      f32,
  centerWidthPct:   f32,
  corrThresholdPct: f32,
  attackMs:         f32,
  releaseMs:        f32,
  detectorHpfHz:    f32,
  surroundDelayMs:  f32,
  surroundHpfHz:    f32,
  surroundLpfHz:    f32,
  decorrPct:        f32,
});

// REQ_UPMIX_SET_PARAM/GET_PARAM (0x4C/0x4D) wValue dispatch: UPMIX_PARAM_*
// ids from upmix.h. Mode/enable ids (0-2) are rounded to integer by firmware
// on SET; presence (13) is fw V26+ (ignored/zeroed on a V25 device).
export const UpmixParam = {
  Enabled:          0,
  CenterMode:       1,
  SurroundMode:     2,
  StrengthPct:      3,
  CenterWidthPct:   4,
  CorrThresholdPct: 5,
  AttackMs:         6,
  ReleaseMs:        7,
  DetectorHpfHz:    8,
  SurroundDelayMs:  9,
  SurroundHpfHz:   10,
  SurroundLpfHz:   11,
  DecorrPct:       12,
  PresenceDb:      13,
} as const;
export type UpmixParam = (typeof UpmixParam)[keyof typeof UpmixParam];

// Standalone control-transfer payloads (not part of the bulk transfer).

// 8-byte payload of `SetMatrixRoute` / response of `GetMatrixRoute`
// (vendor requests 0x70 / 0x71).
export const MatrixRoutePacket = struct({
  input:       u8,
  output:      u8,
  enabled:     bool8,
  phaseInvert: bool8,
  gainDb:      f32,
});

// 16-byte payload of `SetEqParam` (vendor request 0x43).
export const SetFilterPacket = struct({
  channel:   u8,
  band:      u8,
  type:      u8,
  _pad:      reserved(1),
  frequency: f32,
  q:         f32,
  gain:      f32,
});

// 18-byte payload of `SetEqParam` (vendor request 0x42) for a Linkwitz
// Transform band (fw V22+): the 16-byte SetFilterPacket plus a trailing
// qp u16 LE sidecar. Sending the 16-byte SetFilterPacket alone preserves
// the band's currently-stored qp instead of replacing it.
export const SetFilterPacketQp = struct({
  channel:   u8,
  band:      u8,
  type:      u8,
  _pad:      reserved(1),
  frequency: f32,
  q:         f32,
  gain:      f32,
  qp:        u16,
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

// 16-byte live S/PDIF-RX status (GetSpdifRxStatus 0xE2). Stays raw; `state`
// and `inputSource` are narrowed to domain enums in DspDevice.
export const SpdifRxStatus = struct({
  state:        u8,
  inputSource:  u8,
  lockCount:    u8,
  lossCount:    u8,
  sampleRate:   u32,
  parityErrors: u32,
  fifoFillPct:  u16,
  _reserved:    reserved(2),
});

// 16-byte live I2S slave-clock status (GetI2sSlaveStatus 0x8A, fw V21+).
// `state` is narrowed to a domain enum in DspDevice. detectedRate is
// 44100/48000/96000, 0 unless state is LOCKED.
export const I2sSlaveStatus = struct({
  state:        u8,
  clockMode:    u8,
  lockCount:    u8,
  lossCount:    u8,
  detectedRate: u32,
  measuredHz:   u32,
  slipCount:    u8,
  _reserved:    reserved(3),
});

// 16-byte live stereo-upmixer status (GetUpmixStatus 0x4E, fw V25+, RP2350
// only). parkedReason: 0 active / 1 disabled / 2 input not stereo / 3 rate
// > 48 kHz -- narrowed to a domain enum in DspDevice. corr/balance are Q14
// signed fixed point; gains are Q15 unsigned.
export const UpmixStatus = struct({
  active:        bool8,
  parkedReason:  u8,
  corrQ14:       i16,
  balanceQ14:    i16,
  centerGainQ15: u16,
  lsGainQ15:     u16,
  rsGainQ15:     u16,
  _reserved:     reserved(4),
});

// Length of the raw IEC-60958 channel-status block (GetSpdifRxChStatus 0xE3).
// No semantic codec -- surfaced verbatim as bytes.
export const SPDIF_RX_CH_STATUS_LEN = 24;

// 5-byte GetSpdifInputConfig response (0xEF, fw 1.1.5+). enableMask here is
// unshifted: bit0 = input 1 (always set), bit1 = input 2, bit2 = input 3.
// Distinct from spdifRxEnabledExtP1's mask+1 encoding in the bulk section.
export const SpdifInputConfig = struct({
  count:      u8,
  enableMask: u8,
  pins:       arr(u8, 3),
});

// 8-byte payload of SetUartConfig (0xF5) / response of GetUartConfig (0xF6).
// Fixed 8N1 framing -- only baud is configurable.
export const UartCtrlConfig = struct({
  enabled:      bool8,
  txPin:        u8,
  rxPin:        u8,
  notifyEnable: bool8,
  baud:         u32,
});

// 8-byte payload of SetI2cConfig (0xF7) / response of GetI2cConfig (0xF8).
export const I2cCtrlConfig = struct({
  enabled:   bool8,
  sdaPin:    u8,
  sclPin:    u8,
  address:   u8,
  _reserved: reserved(4),
});

// 8-byte response of GetCtrlIfaceStatus (0xF9). last_status is the
// PIN_CONFIG_* result of the most recent SET for that interface; live
// reflects whether the interface is actually up (can differ from
// config.enabled after a boot-time pin collision kept it down).
export const CtrlIfaceStatus = struct({
  uartLastStatus: u8,
  uartLive:       bool8,
  i2cLastStatus:  u8,
  i2cLive:        bool8,
  protoVersion:   u8,
  _reserved:      reserved(3),
});

// Control Surfaces (V16 / fw 1.1.5, caps v3, 0x84-0x87 + 0x8B-0x8C + 0x9D-0x9E).
// Continuous dB/percent/Q fields are signed 8.8 fixed point; Hz fields are
// plain integers; bool/enum values are plain ints. Binding/name SETs are
// live-only previews -- CsSave/CsRevert persist or discard them.

// 24-byte payload of SetCsBinding (0x84, wValue = slot) / response of
// GetCsBinding (0x85). gpio1 is 0xFF (CS_GPIO_UNUSED) unless the type needs
// two pins (encoder channel B); event is a button concept (0 otherwise).
export const CsBinding = struct({
  type:       u8,
  noun:       u8,
  action:     u8,
  flags:      u8,
  gpio0:      u8,
  gpio1:      u8,
  event:      u8,
  target:     u8,
  index:      u8,
  _reserved:  reserved(1),
  value:      i16,
  step:       i16,
  rangeMin:   i16,
  rangeMax:   i16,
  _reserved2: reserved(6),
});

// 4-byte per-type capability descriptor inside the GetCsCaps header/body.
export const CsTypeDesc = struct({
  actions:  u16,
  pinCount: u8,
  pinClass: u8,   // 0 = any GPIO, 1 = ADC (26-28)
});

// 4-byte GetCsCaps (0x86, wValue = 0xFFFF) response prefix. type_count
// CsTypeDesc entries and the v3 tail (CsCapsBody) follow; type_count varies
// by firmware, so DspDevice decodes the prefix first and builds the body
// codec from it rather than assuming a fixed table length.
export const CsCapsPrefix = struct({
  capsVersion: u8,
  maxBindings: u8,
  typeCount:   u8,
  nounCount:   u8,
});

// Body following CsCapsPrefix: `typeCount` CsTypeDesc entries, then the v3
// tail {max_ir_commands, reserved[3]}. A caps-v2 response (no tail) decodes
// via decodePadded with maxIrCommands 0.
export function CsCapsBody(typeCount: number) {
  return struct({
    types:         arr(CsTypeDesc, typeCount),
    maxIrCommands: u8,
    _reserved:     reserved(3),
  });
}

// 12-byte GetCsCaps response for wValue = noun index (0..noun_count-1).
export const CsNounDesc = struct({
  kind:        u8,    // 0 = continuous, 1 = bool, 2 = enum
  enumCount:   u8,
  actions:     u16,
  minQ8:       i16,
  maxQ8:       i16,
  unit:        u8,    // CS_UNIT_*
  targetKind:  u8,    // CS_TARGET_*
  targetCount: u8,
  dflags:      u8,    // CS_NDF_*
});

// 32-byte GetCsStatus (0x87) response. last_status is PENDING (0x16) until
// the deferred main-loop apply of the most recent SET (binding, name, save,
// or revert) has run; last_slot is 0xFF for a save/revert result.
export const CsStatusPacket = struct({
  lastStatus:   u8,
  lastSlot:     u8,
  maxBindings:  u8,
  dirty:        bool8,   // live config differs from the last save
  activeMask:   u16,     // bit N = binding N live
  slotStatus:   arr(u8, 16),
  irActiveMask: u8,
  irLearnState: u8,
  irCmdStatus:  arr(u8, 8),
});

// 32-byte NUL-terminated slot name (SetCsName 0x8B / GetCsName 0x8C). Same
// shape as ChannelName; slot names are metadata independent of the binding.
export const CsName = nulStr(32);

// 16-byte payload of SetCsIrCmd (0x8D, wValue = sub-slot) / response of
// GetCsIrCmd (0x8E). A button-shaped binding fired by a learned IR code
// instead of a GPIO edge; protocol CS_IR_PROTO_NONE (0) with every other
// byte 0 is an empty sub-slot.
export const CsIrCommand = struct({
  noun:      u8,
  action:    u8,
  flags:     u8,
  target:    u8,
  index:     u8,
  protocol:  u8,
  value:     i16,
  step:      i16,
  _reserved: reserved(2),
  code:      u32,
});

// 8-byte response of CsIrLearn (0x8F, wValue = 2): the captured protocol/code
// once an armed learn has completed or timed out. `state` is CS_IR_LEARN_*
// (0..3); protocol/code read 0 on a timeout.
export const CsIrLearnResult = struct({
  state:     u8,
  protocol:  u8,
  _reserved: reserved(2),
  code:      u32,
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

// V16 combined-status shape: clip flags widen to u32 (17 channels exceed 16
// bits) and a trailing live active-input-channel count byte is appended.
// Peak count is 7 (RP2040) or 17 (RP2350).
export function SystemStatus16(numCh: number) {
  return struct({
    peaks:               arr(u16, numCh),
    cpu0:                u8,
    cpu1:                u8,
    clipFlags:           u32,
    activeInputChannels: u8,
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

  // Live active input channel count, source-aware (V16+; u32)
  ActiveInputChannels:   23,

  // TODO(system-info-extra): not yet wired
  // 10..12 (USB packets / alt setting / mounted),
  // 18..21 (per-slot SPDIF starvations),
  // 22 (USB audio ring overruns).
} as const;
export type SystemStatusValue = (typeof SystemStatusValue)[keyof typeof SystemStatusValue];

const V2_PREFIX_SIZE =
  sizeOf(Header) +
  sizeOf(GlobalParams) +
  sizeOf(CrossfeedParams) +
  sizeOf(LegacyChannels) +
  sizeOf(ChannelDelays) +
  sizeOf(Crosspoint) * (Const.NUM_INPUTS * Const.NUM_OUTPUTS) +
  sizeOf(OutputChannel) * Const.NUM_OUTPUTS +
  sizeOf(PinConfig) +
  sizeOf(BandParams) * (Const.NUM_CHANNELS * Const.BANDS_MAX) +
  sizeOf(ChannelNames);  // 2832

const V6_FULL_SIZE =
  V2_PREFIX_SIZE + sizeOf(I2SConfig) + sizeOf(LevellerConfig) + sizeOf(PreampConfig) + sizeOf(MasterVolume);

// Cumulative payload sizes at each format-version boundary. Used by
// bulkLayout() to gate optional sections on header.payload_length.
export const BulkSizes = {
  V2:       V2_PREFIX_SIZE,                                              // 2832
  V3:       V2_PREFIX_SIZE + sizeOf(I2SConfig),                          // 2848
  V4:       V2_PREFIX_SIZE + sizeOf(I2SConfig) + sizeOf(LevellerConfig), // 2864
  V6Preamp: V6_FULL_SIZE - sizeOf(MasterVolume),                         // 2880
  V6Full:   V6_FULL_SIZE,                                                // 2896
  V7:       V6_FULL_SIZE + sizeOf(InputConfig),                          // 2912
  V8:       V6_FULL_SIZE + sizeOf(InputConfig) + sizeOf(LgSoundSync),    // 2928
  V9:       V6_FULL_SIZE + sizeOf(InputConfig) + sizeOf(LgSoundSync) + sizeOf(UserVolume), // 2944
  V10:      V6_FULL_SIZE + sizeOf(InputConfig) + sizeOf(LgSoundSync) + sizeOf(UserVolume) + sizeOf(DacHwMute), // 2960
} as const;

// V16 packet total (5864 bytes). The V16 layout is not size-negotiable:
// firmware accepts only the exact full-size packet (compat deliberately
// broken at V16; WIRE_BULK_PARAMS_MIN_SIZE == sizeof(WireBulkParams)).
export const BULK_SIZE_V16 =
  sizeOf(Header) +
  sizeOf(GlobalParams) +
  sizeOf(CrossfeedParams) +
  sizeOf(LegacyChannels) +
  4 * Const16.NUM_CHANNELS +                                            // delays (17 f32)
  sizeOf(Crosspoint) * (Const16.NUM_INPUTS * Const.NUM_OUTPUTS) +       // 8 x 9
  sizeOf(OutputChannel) * Const.NUM_OUTPUTS +
  sizeOf(PinConfig) +
  sizeOf(BandParams) * (Const16.NUM_CHANNELS * Const.BANDS_MAX) +       // 17 x 12
  Const.CHANNEL_NAME_LEN * Const16.NUM_CHANNELS +                       // names (17 x 32)
  sizeOf(I2SConfig) +
  sizeOf(LevellerConfig) +
  sizeOf(PreampConfig16) +
  sizeOf(MasterVolume) +
  sizeOf(InputConfig) +
  sizeOf(LgSoundSync) +
  sizeOf(UserVolume) +
  sizeOf(DacHwMute) +
  sizeOf(BandParams) * (Const16.NUM_CHANNELS * Const16.XOVER_BANDS);    // crossover (17 x 4)

// V17 appends the 8-byte ADAT config; V18 additionally grows the leveller
// section 16->20 in place. Firmware still accepts only exact-size packets.
export const BULK_SIZE_V17 = BULK_SIZE_V16 + sizeOf(AdatConfig);                                  // 5872
export const BULK_SIZE_V18 = BULK_SIZE_V17 + sizeOf(LevellerConfig18) - sizeOf(LevellerConfig);   // 5876

// V19/V20 claim reserved bytes already inside the V18 layout (loudness output
// mask in GlobalParams, crossfeed output-pair mask in CrossfeedParams) --
// total packet size is unchanged from V18.
export const BULK_SIZE_V19 = BULK_SIZE_V18;
export const BULK_SIZE_V20 = BULK_SIZE_V18;
// V21 claims the InputConfig's first reserved byte (i2s_clock_mode) -- also
// no packet-size change.
export const BULK_SIZE_V21 = BULK_SIZE_V20;
// V22 claims the PEQ band section's reserved bytes (Linkwitz Transform qp) --
// also no packet-size change.
export const BULK_SIZE_V22 = BULK_SIZE_V21;
// V23 appends the 24-byte psychoacoustic bass section after AdatConfig.
export const BULK_SIZE_V23 = BULK_SIZE_V22 + sizeOf(PsybassParams);
// V24 claims InputConfig's remaining reserved bytes (ADAT input config) --
// also no packet-size change.
export const BULK_SIZE_V24 = BULK_SIZE_V23;
// V25 appends the 44-byte stereo upmixer section after PsybassParams.
export const BULK_SIZE_V25 = BULK_SIZE_V24 + sizeOf(UpmixParams);
// V26 claims UpmixParams' reserved byte 3 (presence_q1) -- also no
// packet-size change.
export const BULK_SIZE_V26 = BULK_SIZE_V25;

// Newest wire version the console knows how to decode and write.
export const MAX_WIRE_VERSION = 26;

// Packet size to allocate/write for a given target wire version (clamped to
// the V6 floor and the MAX_WIRE_VERSION ceiling). Versions 11..15 were
// in-development intermediates the console never supported; they collapse to
// the V10 size (writes to such devices are rejected at connect anyway).
export function bulkSizeForVersion(v: number): number {
  if (v >= 25) return BULK_SIZE_V26;
  if (v >= 23) return BULK_SIZE_V24;
  if (v >= 21) return BULK_SIZE_V21;
  if (v >= 20) return BULK_SIZE_V20;
  if (v >= 19) return BULK_SIZE_V19;
  if (v >= 18) return BULK_SIZE_V18;
  if (v >= 17) return BULK_SIZE_V17;
  if (v >= 16) return BULK_SIZE_V16;
  if (v >= 10) return BulkSizes.V10;
  if (v === 9) return BulkSizes.V9;
  if (v === 8) return BulkSizes.V8;
  if (v === 7) return BulkSizes.V7;
  return BulkSizes.V6Full;
}

export const BulkLimits = {
  MinPacketSize:  BulkSizes.V2,
  // Size we WRITE: version-aware buildBulkParams emits at the device's own wire
  // version, up to MAX_WIRE_VERSION. This is the largest buffer it may allocate.
  MaxRequestSize: BULK_SIZE_V26,
  // Size we READ: the largest packet we tolerate receiving (V26).
  MaxReadSize:    BULK_SIZE_V26,  // 5944
  // WinUSB caps a control transfer's data stage at 4 KB; the largest single
  // EP0 transfer any host backend can rely on. Above this, DspDevice chunks
  // via 0xA2/0xA3 (fw 1.1.5+).
  MaxControlTransfer: 4096,
  // Firmware-recommended chunk size for the chunked bulk-params commands.
  ChunkSize: 2048,
} as const;

export interface BulkLayout {
  i2s: boolean;
  leveller: boolean;
  preamp: boolean;
  masterVolume: boolean;
  inputSource: boolean;
  lgSoundSync: boolean;
  userVolume: boolean;
  dacHwMute: boolean;
  // V16 additions: the crossover section and the unified channel model's
  // wide arrays (17 channels / 8 inputs) arrive together.
  crossover: boolean;
  // V17: ADAT lightpipe config, appended at the very end of the packet.
  adat: boolean;
  // V18: leveller detector/apply channel masks (interior section grow).
  levellerMasks: boolean;
  // V19: per-output loudness mask (GlobalParams reserved-byte claim).
  loudnessMask: boolean;
  // V20: crossfeed output-pair mask (CrossfeedParams reserved-byte claim).
  crossfeedPairMask: boolean;
  // V21: I2S clock-mode byte (InputConfig reserved-byte claim).
  i2sClockMode: boolean;
  // V22: PEQ/crossover band reserved bytes are the Linkwitz Transform qp
  // sidecar (BandParamsQp shape). Not type-gated here -- fw forces qp to 0
  // for every non-LT band, so decoding it unconditionally is harmless.
  bandQp: boolean;
  // V23: psychoacoustic bass section, appended after AdatConfig.
  psybass: boolean;
  // V24: ADAT input config bytes (InputConfig reserved-byte claim).
  adatInput: boolean;
  // V25: stereo upmixer section, appended after PsybassParams.
  upmix: boolean;
  // V26: upmixer presence-bell byte (UpmixParams reserved-byte claim).
  upmixPresence: boolean;
}

// Determine which optional sections are present based on the header.
// Both formatVersion and payloadLength must satisfy the threshold --
// matches firmware's bulk_params_apply gating in bulk_params.c.
// A V16 packet trivially satisfies every V10-era size threshold.
export function bulkLayout(h: { formatVersion: number; payloadLength: number }): BulkLayout {
  const v = h.formatVersion;
  const len = h.payloadLength;
  return {
    i2s:          v >= 3  && len >= BulkSizes.V3,
    leveller:     v >= 4  && len >= BulkSizes.V4,
    preamp:       v >= 6  && len >= BulkSizes.V6Preamp,
    masterVolume: v >= 6  && len >= BulkSizes.V6Full,
    inputSource:  v >= 7  && len >= BulkSizes.V7,
    lgSoundSync:  v >= 8  && len >= BulkSizes.V8,
    userVolume:   v >= 9  && len >= BulkSizes.V9,
    dacHwMute:    v >= 10 && len >= BulkSizes.V10,
    crossover:         v >= 16 && len >= BULK_SIZE_V16,
    adat:              v >= 17 && len >= BULK_SIZE_V17,
    levellerMasks:     v >= 18 && len >= BULK_SIZE_V18,
    loudnessMask:      v >= 19 && len >= BULK_SIZE_V19,
    crossfeedPairMask: v >= 20 && len >= BULK_SIZE_V20,
    i2sClockMode:      v >= 21 && len >= BULK_SIZE_V21,
    bandQp:            v >= 22 && len >= BULK_SIZE_V22,
    psybass:           v >= 23 && len >= BULK_SIZE_V23,
    adatInput:         v >= 24 && len >= BULK_SIZE_V24,
    upmix:             v >= 25 && len >= BULK_SIZE_V25,
    upmixPresence:     v >= 26 && len >= BULK_SIZE_V26,
  };
}

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
// masterVolumeMode byte) and `decodePadded` zero-extends -- masterVolumeMode
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
  outputConfigMode: u8,    // byte 5: output-config mode (1.1.4); legacy include-pins bool, values 1:1
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
