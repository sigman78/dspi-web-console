// Wire-format codec schemas, consumed via `import * as Wire from './wireTypes'`.
// C struct names are mirrored minus the redundant `Wire` prefix (the namespace
// supplies it): firmware `WireBandParams` <-> `Wire.BandParams`.
//
// Layout summary (V28 floor, total 5944 bytes; V29+ appends sections at the end):
//   off    bytes  C struct
//     0      16   WireHeader
//    16      16   WireGlobalParams
//    32      16   WireCrossfeedParams
//    48      16   WireLegacyChannels          (ignored)
//    64      68   WireChannelDelays           x 17
//   132     576   WireCrosspoint  x 8 x 9
//   708     108   WireOutputChannel x 9
//   816       8   WirePinConfig
//   824    3264   WireBandParams x 17 x 12
//  4088     544   WireChannelNames            x 17 x 32
//  4632      16   WireI2SConfig
//  4648      20   WireLevellerConfig
//  4668      32   WirePreampConfig            x 8
//  4700      16   WireMasterVolume
//  4716      16   WireInputConfig
//  4732      16   WireLgSoundSync
//  4748      16   WireUserVolume
//  4764      16   WireDacHwMute
//  4780    1088   WireBandParams x 17 x 4     crossover
//  5868       8   WireAdatConfig
//  5876      24   WirePsybassParams
//  5900      44   WireUpmixParams
//  5944                                       end of V28
// V29 SubharmParams (16), V30 SubharmParamsExt (20), V31 TubeParams (48) and
// V32 LimiterParams (108) follow, in that order.

import { Codec, type BinCodec } from '@/utils';

const { u8, i8, u16, u32, i16, f32, bool8, arr, nulStr, reserved, sizeOf, struct } = Codec;

// Wire-format dimensions, sized to the largest platform (RP2350).
export const Const = {
  NUM_CHANNELS:        17,  // WIRE_MAX_CHANNELS (8 in + 9 out)
  NUM_OUTPUTS:          9,  // WIRE_MAX_OUTPUT_CHANNELS
  NUM_INPUTS:           8,  // WIRE_MAX_INPUT_CHANNELS
  XOVER_BANDS:          4,  // WIRE_MAX_XOVER_BANDS
  BANDS_MAX:           12,  // WIRE_MAX_BANDS
  NUM_PIN_OUTPUTS:      5,  // WIRE_MAX_PIN_OUTPUTS
  CHANNEL_NAME_LEN:    32,  // WIRE_NAME_LEN
  NUM_SPDIF_INSTANCES:  4,  // WIRE_MAX_SPDIF_INSTANCES
  SERIAL_LEN:          32,  // GetSerial response length
  // Sentinel pin byte accepted by every single-pin SET command (output data,
  // I2S BCK/MCK, S/PDIF RX, I2S RX): "restore this target's platform default"
  // (index/pair/role-aware). fw config.h PIN_RESET_TO_DEFAULT.
  PIN_RESET_TO_DEFAULT: 0xFF,
} as const;

// Oldest wire version the console talks to (fw 1.1.5 release).
export const MIN_WIRE_VERSION = 28;

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

// Section 2: global params (16 B). Bit k of the loudness mask = loudness
// processes output channel k.
export const GlobalParams = struct({
  preampDb:             f32,
  bypass:               bool8,
  loudnessEnabled:      bool8,
  loudnessOutputMask:   u16,
  loudnessRefSpl:       f32,
  loudnessIntensityPct: f32,
});

// Section 3: crossfeed (16 B). Bit p of the pair mask = crossfeed runs on
// output pair p (outputs 2p/2p+1); the mono PDM sub is excluded.
export const CrossfeedParams = struct({
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

// Section 5: per-channel delays (68 B)
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

// Section 9: EQ band parameters (16 B). bypass = 1 excludes the band from the
// response. qp is the Linkwitz Transform sidecar (u16 LE, round(Qp*512);
// 0 = 0.707 default), meaningful only for type == 11 (LINKWITZ_TRANSFORM);
// firmware forces it to 0 for every other type.
export const BandParams = struct({
  type:      u8,
  bypass:    u8,
  qp:        u16,
  frequency: f32,
  q:         f32,
  gain:      f32,
});

// Section 10: channel names (544 B)
export const ChannelNames = arr(nulStr(Const.CHANNEL_NAME_LEN), Const.NUM_CHANNELS);

// Section 11: I2S config (16 B). clockPinModeP1/bckPinSlave carry the I2S
// slave-clock pins; 0 is the absent value.
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

// Section 12: leveller (20 B). detectorMask/applyMask: bit k = input channel k.
export const LevellerConfig = struct({
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

// Live leveller channel masks: payload of REQ_SET/GET_LEVELLER_MASKS
// (0xDE/0xDF), 2 bytes [detector_mask, apply_mask]. Distinct from the bulk
// section above; carried as a standalone command so masks can be edited live.
export const LevellerMasks = struct({
  detector: u8,
  apply:    u8,
});

// Section 13: per-input preamp (32 B), one f32 per input.
export const PreampConfig = struct({
  preampDb: arr(f32, Const.NUM_INPUTS),
});

// Section 14: master volume. Full 16-byte on-wire footprint: 4 B data +
// 12 B reserved.
export const MasterVolume = struct({
  masterVolumeDb: f32,
  _reserved:      reserved(12),
});

// Section 15: input config (16 B). input_source: 0=USB, 1=S/PDIF, 2=I2S.
// The fw 1.1.5 release relaid the interior out for the fourth selectable
// S/PDIF input: spdifRxPinExt holds the SPDIF 2/3/4 GPIOs (0 = absent/
// keep-live), spdifRxEnabledExtP1 is mask+1 (0 = absent, else bit0=SPDIF2,
// bit1=SPDIF3, bit2=SPDIF4), and no reserved byte remains.
export const InputConfig = struct({
  inputSource:          u8,
  spdifRxPin:           u8,
  i2sRxPin:             u8,            // I2S RX data GPIO, stereo pair 0
  i2sInputRate:         u8,            // enum: 0=44100, 1=48000, 2=96000
  i2sInputChannels:     u8,            // active I2S input channels 2/4/6/8 (0 = absent)
  i2sRxPinExt:          arr(u8, 3),    // RX data GPIOs for stereo pairs 1..3 (0 = unset)
  spdifRxPinExt:        arr(u8, 3),
  spdifRxEnabledExtP1:  u8,
  i2sClockMode:         u8,            // 0 = master, 1 = slave
  adatInputPin:         u8,            // GPIO, 0 = absent/keep-live
  adatInputEnabledP1:   u8,            // 0 absent / 1 disabled / 2 enabled
  adatInputClockModeP1: u8,            // 0 absent / 1 master / 2 slave
});

// Section 16: LG Sound Sync (16 B). Only `enabled` is host-
// configurable through bulk apply; present/volume/muted are runtime state.
export const LgSoundSync = struct({
  enabled:   bool8,
  present:   bool8,
  volume:    u8,
  muted:     bool8,
  _reserved: reserved(12),
});

// Section 17: user volume (16 B). Separate from master-volume.
export const UserVolume = struct({
  volumeDb:  f32,
  mute:      bool8,
  _reserved: reserved(11),
});

// Section 18: DAC hardware mute config (16 B).
export const DacHwMute = struct({
  enabled:    bool8,
  activeLow:  bool8,
  pin:        u8,
  _reserved0: reserved(1),
  holdMs:     u16,
  releaseMs:  u16,
  _reserved:  reserved(8),
});

// Section 20: ADAT lightpipe output config (8 B; RP2350 only). enabled/pin
// are persisted intent; pin == 0 means the platform default. Zeroed/ignored on
// RP2040. Appended at the very end of the packet, after the crossover section.
export const AdatConfig = struct({
  enabled:   bool8,
  pin:       u8,
  _reserved: reserved(6),
});

// Section 21: psychoacoustic bass config (24 B; RP2350 only, but
// structurally present on every packet). Appended after AdatConfig.
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

// Section 22: stereo upmixer config (44 B; RP2350 only, but structurally
// present on every packet). Appended after PsybassParams. presenceQ1 is int8,
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
// on SET.
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

// Section 23: subharmonic synthesizer config (16 B, V29+; both platforms --
// unlike psybass/upmix there is no RP2350 gate). Appended after UpmixParams.
export const SubharmParams = struct({
  enabled:    bool8,
  _reserved0: reserved(1),
  outputMask: u16,
  lowDb:      f32,
  highDb:     f32,
  boostDb:    f32,
});

// V30 tail of section 23 (20 B): third band, selectivity, ceiling, pair link.
export const SubharmParamsExt = struct({
  topDb:        f32,
  selectDepth:  f32,
  selectHoldMs: f32,
  ceilingDb:    f32,
  selectMode:   u8,
  linkPairs:    bool8,
  _reserved1:   reserved(2),
});

// Section 24: tube preamp emulation (48 B, V31+; both platforms).
export const TubeParams = struct({
  enabled:      bool8,
  tubeType:     u8,
  rectifier:    u8,
  xfmrEnabled:  bool8,
  outputMask:   u16,
  _reserved0:   reserved(2),
  driveDb:      f32,
  biasPct:      f32,
  asymDb:       f32,
  hardnessPct:  f32,
  sagPct:       f32,
  xfmrDamping:  f32,
  xfmrResHz:    f32,
  mixPct:       f32,
  trimDb:       f32,
  _reservedF:   reserved(4),   // reserved float, zero
});

// Section 25: per-output limiter (108 B, V32+; both platforms). Entries past
// the platform's output count are zero on GET and ignored on SET.
export const LimiterEntry = struct({
  enabled:     bool8,
  linkGroup:   u8,
  _reserved0:  reserved(2),
  thresholdDb: f32,
  releaseMs:   f32,
});
export const LimiterParams = arr(LimiterEntry, Const.NUM_OUTPUTS);

// REQ_LIMITER (0x81) wValue = (output << 8) | index. Index ids for the
// per-parameter SET/GET; ids 0x80+ are read-only GET blocks.
export const LimiterParam = {
  Enabled:     0,
  ThresholdDb: 1,
  ReleaseMs:   2,
  LinkGroup:   3,
} as const;
export type LimiterParam = (typeof LimiterParam)[keyof typeof LimiterParam];

// Index 0x80: NUM_OUTPUT_CHANNELS x u16 LE gain reduction in 0.01 dB.
export const LIMITER_GET_METER = 0x80;
// Index 0x81: LimiterStatus block; a bad index STALLs, so this feature-detects.
export const LIMITER_GET_STATUS = 0x81;
// Output byte that applies a SET to every output.
export const LIMITER_ALL_OUTPUTS = 0xFF;

export function limiterWValue(output: number, index: number): number {
  return ((output & 0xFF) << 8) | (index & 0xFF);
}

// 4-byte live limiter status (REQ_LIMITER GET index 0x81). engaged = the
// lookahead delay is in the signal path (every output 32 samples later).
export const LimiterStatus = struct({
  engaged:          u8,
  lookaheadSamples: u8,
  blockSamples:     u8,
  numOutputs:       u8,
});

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
// Transform band: the 16-byte SetFilterPacket plus a trailing
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
// Six u8 metrics + a u16 sample-granular fill in 0.01% units on the same
// 16-bucket scale as consumerFillPct (5000 = 50.00%; can exceed 100%).
// Former reserved bytes: reads 0 on firmware without it.
export const SpdifBufferStats = struct({
  consumerFree:       u8,
  consumerPrepared:   u8,
  consumerPlaying:    u8,
  consumerFillPct:    u8,
  consumerMinFillPct: u8,
  consumerMaxFillPct: u8,
  fillCentiPct:       u16,
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

// 16-byte live I2S slave-clock status (GetI2sSlaveStatus 0x8A).
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

// 2-byte SetSysClock payload (0x40, fw overclock branch). vregSel 0xFF means
// "use the mode's default voltage".
export const SysClockRequest = struct({
  mode:    u8,
  vregSel: u8,
});

// 8-byte GetSysClock response (0x41). storedVregSel preserves the raw 0xFF
// sentinel; liveVreg is always a concrete enum. fallbackActive means the
// device crash-rebooted to safe mode 0 (latched until a power cycle or a
// fresh SetSysClock).
export const SysClockStatus = struct({
  activeMode:     u8,
  storedMode:     u8,
  storedVregSel:  u8,
  liveVreg:       u8,
  fallbackActive: bool8,
  _reserved:      reserved(3),
});

// 16-byte live stereo-upmixer status (GetUpmixStatus 0x4E, RP2350
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

// 8-byte live ADAT lightpipe output status (GetAdatStatus 0xCE,
// RP2350 only). `enabled` is persisted intent, `active` is running now.
// `rateOk` reflects whether the device rate is 44.1/48 kHz -- the stream
// auto-suspends outside that range and resumes when the rate returns.
export const AdatStatus = struct({
  enabled:     bool8,
  active:      bool8,
  pin:         u8,
  rateOk:      bool8,
  resyncCount: u16,
  slipCount:   u16,
});

// 20-byte live ADAT lightpipe input status (GetAdatInputStatus 0x6E,
// RP2350 only; RP2040 reports 20 zero bytes). state/clockMode are live values,
// not persisted config. rateOk parks master-mode acquisition when the device
// rate exceeds 48 kHz -- always 1 in slave mode. detectedRate is the snapped
// wire rate (slave, valid from SYNCING) or the device rate (master); 0 when
// unknown/parked. measuredHz is the raw slave-mode wire rate, 0 in master mode.
export const AdatInputStatus = struct({
  state:        u8,
  clockMode:    u8,
  enabled:      bool8,
  pin:          u8,
  rateOk:       bool8,
  lockCount:    u8,
  lossCount:    u8,
  slipCount:    u8,
  headerErr:    u16,
  _reserved:    reserved(2),
  detectedRate: u32,
  measuredHz:   u32,
});

// Length of the raw IEC-60958 channel-status block (GetSpdifRxChStatus 0xE3).
// No semantic codec -- surfaced verbatim as bytes.
export const SPDIF_RX_CH_STATUS_LEN = 24;

// 6-byte GetSpdifInputConfig response (0xEF). enableMask here is unshifted:
// bit0 = input 1 (always set), bit1 = input 2, bit2 = input 3, bit3 = input 4.
// Distinct from spdifRxEnabledExtP1's mask+1 encoding in the bulk section.
export const SpdifInputConfig = struct({
  count:      u8,
  enableMask: u8,
  pins:       arr(u8, 4),
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

// Control Surfaces (fw 1.1.5, caps v3, 0x84-0x87 + 0x8B-0x8C + 0x9D-0x9E).
// Continuous dB/percent/Q fields are signed 8.8 fixed point; Hz fields are
// plain integers; bool/enum values are plain ints. Binding/name SETs are
// live-only previews -- CsSave/CsRevert persist or discard them.

// 24-byte payload of SetCsBinding (0x84, wValue = slot) / response of
// GetCsBinding (0x85). gpio1 is 0xFF (CS_GPIO_UNUSED) unless the type needs
// two pins (encoder channel B); event is a button concept (0 otherwise).
// baseBright (caps v12) and onDelay/offDelay (caps v8) are real fields on
// newer firmware but reserved-must-be-zero on older firmware. reserved2 is
// decoded and re-encoded verbatim, never zero-filled: a future format may
// carve a real field out of it, and an edit round-trip from this console
// must not wipe what another host configured.
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
  baseBright: u8,
  value:      i16,
  step:       i16,
  rangeMin:   i16,
  rangeMax:   i16,
  onDelay:    u16,
  offDelay:   u16,
  reserved2:  arr(u8, 2),
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

// Body following CsCapsPrefix: `typeCount` CsTypeDesc entries, then the tail
// {max_ir_commands, max_groups, max_macros, max_macro_steps}. max_ir_commands
// is caps v3+; the other three are caps v9+, carved from the 3 bytes reserved
// there through v8 (a v3-v8 response sends zeros for them). A caps-v2
// response (no tail at all) decodes via decodePadded with every tail field 0.
export function CsCapsBody(typeCount: number) {
  return struct({
    types:         arr(CsTypeDesc, typeCount),
    maxIrCommands: u8,
    maxGroups:     u8,
    maxMacros:     u8,
    maxMacroSteps: u8,
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

// 32-byte GetCsStatus (0x87) response, caps v2-v5 firmware (8-entry IR
// status). last_status is PENDING (0x16) until the deferred main-loop apply
// of the most recent SET (binding, name, save, or revert) has run; last_slot
// is 0xFF for a save/revert result. DspDevice picks this layout vs.
// CsStatusPacketV6 by response length, never a hardcoded caps version.
export const CsStatusPacketV3 = struct({
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

// 41-byte GetCsStatus (0x87) response, caps v6+ firmware: CS_MAX_IR_COMMANDS
// grew 8 -> 16, widening ir_active_mask to u16 and ir_cmd_status to 16 bytes.
// Same first 22 bytes as CsStatusPacketV3.
export const CsStatusPacketV6 = struct({
  lastStatus:   u8,
  lastSlot:     u8,
  maxBindings:  u8,
  dirty:        bool8,
  activeMask:   u16,
  slotStatus:   arr(u8, 16),
  irActiveMask: u16,
  irLearnState: u8,
  irCmdStatus:  arr(u8, 16),
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

// 40-byte payload of SetCsGroup (0x20, wValue = group 0-7) / response of
// GetCsGroup (0x21). All-zero (targetKind 0) marks an empty slot; `reserved`
// is zero-filled by the codec (firmware rejects a non-zero value).
export const CsGroup = struct({
  targetKind: u8,
  _reserved:  reserved(3),
  memberMask: u32,
  name:       nulStr(32),
});

// 12-byte SET payload of SetCsMacroStep (0x24, wValue = (step<<8)|macro);
// also one element of GetCsMacro's steps array. All-zero = empty step --
// always valid, skipped at run time.
export const CsMacroStep = struct({
  noun:      u8,
  action:    u8,
  flags:     u8,
  target:    u8,
  index:     u8,
  _reserved: reserved(1),
  value:     i16,
  step:      i16,
  preDelay:  u16,
});

// 36-byte payload of SetCsMacro (0x22, wValue = macro 0-7): name + step count.
export const CsMacroHeader = struct({
  name:       nulStr(32),
  stepCount:  u8,
  _reserved:  reserved(3),
});

// 132-byte GetCsMacro (0x23) response, wValue = macro 0-7 (wValue >= 8
// STALLs). Steps start at offset 36, 12 B each; execution uses
// steps[0..step_count-1] -- stored steps beyond step_count are inert.
// "Empty macro" = name '' + step_count 0.
export const CsMacro = struct({
  name:       nulStr(32),
  stepCount:  u8,
  _reserved:  reserved(3),
  steps:      arr(CsMacroStep, 8),
});

// 24-byte GetCsExtStatus (0x26, wValue = 0) response: group/macro ceilings
// and per-slot validity. Macro fields (0x22-0x25 -- CsMacro/CsMacroStep/
// CsMacroHeader above) are modeled.
export const CsExtStatusPacket = struct({
  maxGroups:      u8,
  maxMacros:      u8,
  maxMacroSteps:  u8,
  macroRunning:   u8,   // index; 0xFF = idle
  macroStep:      u8,
  _reserved:      reserved(3),
  groupStatus:    arr(u8, 8),
  macroStatus:    arr(u8, 8),
});

// I2C displays (caps v10+, 0x27-0x2B). 12-byte SET payload of
// SetCsDisplayCfg (0x27); also the tail of GetCsDisplayCfg's (0x28) 16-byte
// response.
export const CsDisplayCfg = struct({
  mode:        u8,
  homePage:    u8,
  dwell:       u16,
  overlayHold: u16,
  brightness:  u8,
  flags:       u8,
  editTimeout: u16,
  _reserved:   reserved(2),
});

// 16-byte GetCsDisplayCfg (0x28) response: a 4-byte header (max page count,
// selectable model count, 2 reserved) followed by CsDisplayCfg.
export const CsDisplayCfgResponse = struct({
  maxPages:   u8,
  modelCount: u8,
  _reserved:  reserved(2),
  cfg:        CsDisplayCfg,
});

// 4-byte payload of SetCsDisplayPage (0x29, wValue = page) / response of
// GetCsDisplayPage (0x2A, wValue = page). flags bit0 ACTIVE, bit1 GROUP,
// bit2 LARGE, bit3 BAR; an all-zero record is an empty page slot.
export const CsDisplayPage = struct({
  noun:   u8,
  target: u8,
  index:  u8,
  flags:  u8,
});

// 8-byte GetCsDisplayStatus (0x2B) response. initState: 0 DOWN/1 INIT/2
// LIVE/3 ERROR; currentPage 0xFF when none is shown; flags bit0 overlay
// showing, bit1 edit armed; model is the live binding's index, 0 when down.
export const CsDisplayStatus = struct({
  initState:   u8,
  currentPage: u8,
  flags:       u8,
  model:       u8,
  nakCount:    u16,
  _reserved:   reserved(2),
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

// fw 1.1.6+ answers 6 bytes: the same 4-byte prefix plus full-width minor
// and patch, lifting the nibble-packed byte's cap of 15. Older fw clamps the
// response to 4 bytes, so the reader must branch on the length received.
export const DeviceInfoExt = struct({
  platformId:   u8,
  fwMajor:      u8,
  fwMinorPatch: u8,
  _reserved:    reserved(1),
  fwMinor:      u8,
  fwPatch:      u8,
});

// 64-byte `GetBuildInfo` (0x80, fw 1.1.6+) response: git describe + build
// date, both NUL-terminated ASCII in fixed windows. Provenance for humans
// only -- never a compatibility gate; that stays the GetPlatform version.
export const BuildInfo = struct({
  describe:  nulStr(48),
  date:      nulStr(12),
  _reserved: reserved(4),
});

// Parametric `GetStatus` (0x50, wValue 9) combined-status schema: the peak
// count varies by platform (7 on RP2040, 17 on RP2350); clip flags are u32
// (17 channels exceed 16 bits) and a live active-input-channel count byte
// trails. Returns a fresh struct codec for the requested channel count; use
// through `encode` / `decode` like any other codec.
export function SystemStatus(numCh: number) {
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

  // Live active input channel count, source-aware (u32)
  ActiveInputChannels:   23,

  // TODO(system-info-extra): not yet wired
  // 10..12 (USB packets / alt setting / mounted),
  // 18..21 (per-slot SPDIF starvations),
  // 22 (USB audio ring overruns).
} as const;
export type SystemStatusValue = (typeof SystemStatusValue)[keyof typeof SystemStatusValue];

// V28 packet total (5944 bytes), summed from the section codecs so a layout
// drift fails loudly. Firmware accepts only exact-size packets.
export const BULK_SIZE_V28 =
  sizeOf(Header) +
  sizeOf(GlobalParams) +
  sizeOf(CrossfeedParams) +
  sizeOf(LegacyChannels) +
  sizeOf(ChannelDelays) +
  sizeOf(Crosspoint) * (Const.NUM_INPUTS * Const.NUM_OUTPUTS) +
  sizeOf(OutputChannel) * Const.NUM_OUTPUTS +
  sizeOf(PinConfig) +
  sizeOf(BandParams) * (Const.NUM_CHANNELS * Const.BANDS_MAX) +
  sizeOf(ChannelNames) +
  sizeOf(I2SConfig) +
  sizeOf(LevellerConfig) +
  sizeOf(PreampConfig) +
  sizeOf(MasterVolume) +
  sizeOf(InputConfig) +
  sizeOf(LgSoundSync) +
  sizeOf(UserVolume) +
  sizeOf(DacHwMute) +
  sizeOf(BandParams) * (Const.NUM_CHANNELS * Const.XOVER_BANDS) +  // crossover
  sizeOf(AdatConfig) +
  sizeOf(PsybassParams) +
  sizeOf(UpmixParams);
// V29 appends the 16-byte subharmonic synthesizer section.
export const BULK_SIZE_V29 = BULK_SIZE_V28 + sizeOf(SubharmParams);
// V30 grows the subharm section with a third band, selectivity, ceiling, and
// pair link (+20 B).
export const BULK_SIZE_V30 = BULK_SIZE_V29 + sizeOf(SubharmParamsExt);
// V31 appends the 48-byte tube preamp section.
export const BULK_SIZE_V31 = BULK_SIZE_V30 + sizeOf(TubeParams);
// V32 appends the 108-byte per-output limiter section (9 x 12 B).
export const BULK_SIZE_V32 = BULK_SIZE_V31 + sizeOf(LimiterParams);

// Newest wire version the console knows how to decode and write.
export const MAX_WIRE_VERSION = 32;

// Packet size to allocate/write for a given target wire version (versions
// above the ceiling use the newest known size).
export function bulkSizeForVersion(v: number): number {
  if (v >= 32) return BULK_SIZE_V32;
  if (v >= 31) return BULK_SIZE_V31;
  if (v >= 30) return BULK_SIZE_V30;
  if (v >= 29) return BULK_SIZE_V29;
  return BULK_SIZE_V28;
}

export const BulkLimits = {
  MinPacketSize:  BULK_SIZE_V28,
  // Size we WRITE: version-aware buildBulkParams emits at the device's own wire
  // version, up to MAX_WIRE_VERSION. This is the largest buffer it may allocate.
  MaxRequestSize: BULK_SIZE_V32,
  // Size we READ: the largest packet we tolerate receiving (V32).
  MaxReadSize:    BULK_SIZE_V32,
  // Firmware-recommended chunk size for the chunked bulk-params commands.
  ChunkSize: 2048,
} as const;

// Sections that vary among supported firmware (V29+); everything older is
// unconditional.
export interface BulkLayout {
  // V29: subharmonic synthesizer section, appended after UpmixParams.
  subharm: boolean;
  // V30: subharm section tail (third band, selectivity, ceiling, pair link).
  subharmExt: boolean;
  // V31: tube preamp section, appended after the subharm section.
  tube: boolean;
  // V32: per-output limiter section, appended after the tube section.
  limiter: boolean;
}

// Determine which trailing sections are present based on the header.
// Both formatVersion and payloadLength must satisfy the threshold --
// matches firmware's bulk_params_apply gating in bulk_params.c.
export function bulkLayout(h: { formatVersion: number; payloadLength: number }): BulkLayout {
  const v = h.formatVersion;
  const len = h.payloadLength;
  return {
    subharm:    v >= 29 && len >= BULK_SIZE_V29,
    subharmExt: v >= 30 && len >= BULK_SIZE_V30,
    tube:       v >= 31 && len >= BULK_SIZE_V31,
    limiter:    v >= 32 && len >= BULK_SIZE_V32,
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

// Preset directory packet (response to GetPresetDir 0x95), 7 bytes. Always
// request exactly 7 bytes from the device: WinUSB treats device-overrun as a
// babble error and fails the transfer.
//
// The consumer-facing shape lives in `domain/presetDirectory.ts`; this
// codec stays raw (u8/u16/bool8) and is only consumed by DspDevice.
export const PresetDirectory = struct({
  occupiedMask:     u16,
  startupMode:      u8,
  defaultSlot:      u8,
  lastActiveSlot:   u8,
  outputConfigMode: u8,    // byte 5: output-config persistence mode
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
