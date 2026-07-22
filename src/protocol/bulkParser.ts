// Bulk packet parser. Maps the wire structs from `./wireTypes.ts` onto the
// `BulkParams` DTO and gates optional sections by version and buffer length.
//
// Dual channel-model generations: V10 (2 inputs / 11 channels) and V16
// (8 inputs / 17 channels + crossover). The DTO is always V16-max shaped;
// a V10 packet fills its rows and the parser pads the rest with defaults.
// Rows are wire-indexed per the packet's own generation, so a round-trip
// through build at the same version is loss-free.

import { BinReader, BinWriter, Codec } from '@/utils';
import * as Wire from './wireTypes';
import type {
  Loudness, Psybass, Upmix,
  CrossPoint, OutputState,
} from '@/domain';

// PEQ FilterType 11 = LINKWITZ_TRANSFORM (fw config.h). Duplicated as a raw
// wire value rather than imported from domain.FilterType -- this file stays
// domain-free (see the file banner above).
const WIRE_FILTER_TYPE_LINKWITZ_TRANSFORM = 11;

// Wire-shaped I2S section: domain I2sConfig's clockPinMode is DECODED from
// clockPinModeP1 (0 = absent -> 0, else p1-1) in snapshotCodec.ts, mirroring
// spdifRxEnabledExtP1's split. bckPinSlave needs no decode (0 = unset is
// already the domain value).
export interface WireI2s {
  outputSlotTypes: [number, number, number, number];
  bckPin: number;
  mckPin: number;
  mckEnabled: boolean;
  mckMultiplierEncoded: number;
  clockPinModeP1: number;
  bckPinSlave: number;
}

// The parsed bulk packet as a plain DTO. All sections are populated; when the
// wire omits an optional section (older firmware) the parser substitutes
// defaultBulkParams(). formatVersion is preserved so consumers can decide
// whether to surface those as null in their own DTOs.
//
// Filters stay raw wire shape (type: number) so this file has zero domain
// imports; narrowing to FilterType happens in snapshotCodec.ts.
export interface WireFilter {
  type: number;
  bypass: boolean;
  frequency: number;
  q: number;
  gain: number;
  // Linkwitz Transform qp sidecar (V22+ wire; BandParams reserved bytes).
  // Raw u16 (round(Qp*512), 0 = default 0.707); 0 for every non-LT band --
  // firmware forces it on apply. Decoded to a true Qp value in
  // snapshotCodec.narrowFilter, never here (this file stays mechanical).
  qpRaw: number;
}

export interface WireInputConfig {
  source: number;
  spdifRxPin: number;
  // V16 fields; zeros on a V10 packet ("absent" convention).
  i2sRxPins: number[];          // length 4, pair 0 first (0 = unset)
  i2sInputRateEnc: number;      // 0=44100, 1=48000, 2=96000
  i2sInputChannels: number;     // 2/4/6/8 (0 = absent)
  // fw 1.1.5+ multi-SPDIF fields; zeros on older packets ("absent" convention).
  spdifRxPinExt: number[];      // length 2, GPIOs for SPDIF2/3 (0 = absent/keep-live)
  spdifRxEnabledExtP1: number;  // enable mask + 1 (0 = absent)
  // fw V21+ I2S clock role: 0 = master, 1 = slave. 0 on older packets.
  i2sClockMode: number;
  // fw V24+ ADAT input config; zeros ("absent") on older packets. GPIO raw;
  // enabled/clockMode are p1-encoded (0 = absent), same convention as
  // spdifRxEnabledExtP1 -- decoded in snapshotCodec.ts.
  adatInputPin: number;
  adatInputEnabledP1: number;
  adatInputClockModeP1: number;
}
export interface WireLgSoundSync { enabled: boolean; present: boolean; volume: number; muted: boolean; }
export interface WireUserVolume  { volumeDb: number; mute: boolean; }
export interface WireDacHwMute   { enabled: boolean; activeLow: boolean; pin: number; holdMs: number; releaseMs: number; }

// Wire-shaped feature types. Parser emits these as-is; domain narrowing
// to CrossfeedPreset / LevellerSpeed enums happens in fromBulkParams.
export interface WireCrossfeed {
  enabled: boolean;
  preset: number;
  itd: boolean;
  freq: number;
  feedDb: number;
  // Output-pair mask (fw V20+): bit p = output pair p. Default 0x01 (pair 1
  // only) on pre-V20 packets -- matches firmware's legacy stereo behaviour.
  outputPairMask: number;
}

export interface WireLeveller {
  enabled: boolean;
  speed: number;
  lookahead: boolean;
  amount: number;
  maxGainDb: number;
  gateDb: number;
  detectorMask: number;
  applyMask: number;
}

// Section 20: ADAT lightpipe output config (V17+).
export interface WireAdat {
  enabled: boolean;
  pin: number;
}

// Section 21: psychoacoustic bass config (V23+). Wire-shaped 1:1 with
// domain.Psybass -- no narrowing needed in snapshotCodec.ts.
export type WirePsybass = Psybass;

// Section 22: stereo upmixer config (V25+). Wire-shaped 1:1 with domain.Upmix
// -- presenceQ1 is decoded to presenceDb right here (a plain scale, unlike
// the Linkwitz Transform qp sidecar's type-conditional decode), so no
// narrowing is needed in snapshotCodec.ts either.
export type WireUpmix = Upmix;

export interface BulkParams {
  formatVersion: number;
  payloadLength: number;
  platformId: number;
  numCh: number;
  numOut: number;
  numIn: number;
  maxBands: number;

  bypass: boolean;
  preampDb: number;

  loudness: Loudness;
  crossfeed: WireCrossfeed;

  delaysMs: number[];                 // length 17 (V10 fills 11)
  crosspoints: CrossPoint[][];        // [8][9]   (V10 fills rows 0..1)
  outputs: OutputState[];             // length 9

  numPinOutputs: number;
  pins: number[];                     // length 5

  filters: WireFilter[][];            // [17][12], raw wire shape (V10 fills 11 rows)
  channelNames: string[];             // length 17 (V10 fills 11)

  i2s: WireI2s;
  leveller: WireLeveller;

  inputPreampsDb: number[];           // length 8 (V10 fills 2)
  masterVolumeDb: number;             // V6+

  inputConfig: WireInputConfig;       // V7+ (i2s fields V16+)
  lgSoundSync: WireLgSoundSync;       // V8+
  userVolume:  WireUserVolume;        // V9+
  dacHwMute:   WireDacHwMute;         // V10+

  crossover: WireFilter[][];          // [17][4], V16+ (flat defaults on V10)
  adat: WireAdat;                     // V17+
  psybass: WirePsybass;               // V23+
  upmix: WireUpmix;                   // V25+
}

function defaultWireFilter(): WireFilter {
  return { type: 0, bypass: false, frequency: 1000, q: 1, gain: 0, qpRaw: 0 };
}

function readWireFilter(r: BinReader, withQp: boolean): WireFilter {
  if (withQp) {
    const b = Wire.BandParamsQp.read(r);
    return { type: b.type, bypass: b.bypass === 1, frequency: b.frequency, q: b.q, gain: b.gain, qpRaw: b.qp };
  }
  const b = Wire.BandParams.read(r);
  return { type: b.type, bypass: b.bypass === 1, frequency: b.frequency, q: b.q, gain: b.gain, qpRaw: 0 };
}

function writeWireFilter(w: BinWriter, f: WireFilter, withQp: boolean): void {
  if (withQp) {
    Wire.BandParamsQp.write(w, {
      type: f.type, bypass: f.bypass ? 1 : 0,
      qp: f.type === WIRE_FILTER_TYPE_LINKWITZ_TRANSFORM ? f.qpRaw : 0,
      frequency: f.frequency, q: f.q, gain: f.gain,
    });
    return;
  }
  Wire.BandParams.write(w, { type: f.type, bypass: f.bypass ? 1 : 0, frequency: f.frequency, q: f.q, gain: f.gain });
}

// Upmixer presence-bell wire encoding (V26+ UpmixParams.presenceQ1): int8 =
// round(clamp(dB, -12, 12) * 2). V25 packets have no presence byte -- callers
// write 0 (flat) and read 0 unconditionally (see layout.upmixPresence).
export function encodePresenceQ1(db: number): number {
  return Math.round(Math.max(-12, Math.min(12, db)) * 2);
}
export function decodePresenceQ1(raw: number): number {
  return raw / 2;
}

// Decode just the 16-byte Wire.Header from a (possibly partial) bulk read --
// used to derive capabilities/total length without transferring the whole
// packet (the WinUSB 4 KB control-transfer cap makes a full V16 peek
// untransferable on some hosts).
export function peekBulkHeader(bytes: Uint8Array): ReturnType<typeof Wire.Header.read> {
  const need = Codec.sizeOf(Wire.Header);
  if (bytes.length < need) {
    throw new Error(`peekBulkHeader: buffer too small (${bytes.length} bytes, need ${need}).`);
  }
  return Wire.Header.read(new BinReader(bytes));
}

export function parseBulkParams(buffer: Uint8Array): BulkParams {
  if (buffer.length < Wire.BulkLimits.MinPacketSize) {
    throw new Error(
      `bulk packet too small: got ${buffer.length}, need at least ${Wire.BulkLimits.MinPacketSize}.`,
    );
  }
  const r = new BinReader(buffer);

  const h = Wire.Header.read(r);
  const layout = Wire.bulkLayout({ formatVersion: h.formatVersion, payloadLength: h.payloadLength });
  // On-wire array dims follow the packet's own generation, not the header's
  // per-platform channel counts (arrays are fixed at the generation max).
  const dims = Wire.dimsForVersion(h.formatVersion);

  // Defaults source: fills any section the wire omits.
  const def = defaultBulkParams({
    platformId: h.platformId,
    numCh:      h.numCh,
    numOut:     h.numOut,
    numIn:      h.numIn,
    maxBands:   h.maxBands,
  });

  // Sections 2/3 are required (always present, fixed position); only the
  // codec variant used to decode them depends on the wire version -- both
  // variants are the same 16-byte size, so stream position is unaffected.
  const g = layout.loudnessMask
    ? (() => {
        const w = Wire.GlobalParams19.read(r);
        return {
          preampDb: w.preampDb, bypass: w.bypass, loudnessEnabled: w.loudnessEnabled,
          loudnessRefSpl: w.loudnessRefSpl, loudnessIntensityPct: w.loudnessIntensityPct,
          loudnessOutputMask: w.loudnessOutputMask,
        };
      })()
    : (() => {
        const w = Wire.GlobalParams.read(r);
        return {
          preampDb: w.preampDb, bypass: w.bypass, loudnessEnabled: w.loudnessEnabled,
          loudnessRefSpl: w.loudnessRefSpl, loudnessIntensityPct: w.loudnessIntensityPct,
          loudnessOutputMask: 0xFFFF,
        };
      })();

  const cf = layout.crossfeedPairMask
    ? (() => {
        const w = Wire.CrossfeedParams20.read(r);
        return { enabled: w.enabled, preset: w.preset, itd: w.itd, freq: w.freq, feedDb: w.feedDb, outputPairMask: w.outputPairMask };
      })()
    : (() => {
        const w = Wire.CrossfeedParams.read(r);
        return { enabled: w.enabled, preset: w.preset, itd: w.itd, freq: w.freq, feedDb: w.feedDb, outputPairMask: 0x01 };
      })();

  Wire.LegacyChannels.read(r);  // 16 B reserved block, ignored

  // Parsed but deliberately not modeled: firmware's delay engine only reads
  // output-channel delays (input entries are stored-but-inert), and the bulk
  // outputs section overrides the output entries right after this section is
  // applied -- outputs[].delayMs is the authoritative copy the snapshot models.
  // The builder echoes the parsed values back unchanged; firmware's
  // outputs-section override makes that harmless.
  const delaysMs = [...def.delaysMs];
  for (let i = 0; i < dims.numCh; i++) delaysMs[i] = Codec.f32.read(r);

  const crosspoints = [...def.crosspoints];
  for (let inp = 0; inp < dims.numIn; inp++) {
    crosspoints[inp] = Array.from({ length: Wire.Const.NUM_OUTPUTS }, () => Wire.Crosspoint.read(r));
  }

  const outputs = Array.from({ length: Wire.Const.NUM_OUTPUTS }, () => Wire.OutputChannel.read(r));

  const pinCfg = Wire.PinConfig.read(r);

  const filters = [...def.filters];
  for (let ch = 0; ch < dims.numCh; ch++) {
    filters[ch] = Array.from({ length: Wire.Const.BANDS_MAX }, () => readWireFilter(r, layout.bandQp));
  }

  const channelNames = [...def.channelNames];
  for (let ch = 0; ch < dims.numCh; ch++) channelNames[ch] = Wire.ChannelName.read(r);

  // Optional V6 tail sections -- read if present, else use factory defaults.
  // V10-era codecs are 16 B each, so sequential reads line up with on-wire
  // offsets; the V16 preamp section grows to 32 B.
  const i2s = layout.i2s
    ? (() => {
        const w = Wire.I2SConfig.read(r);
        return {
          outputSlotTypes: [
            w.outputSlotTypes[0], w.outputSlotTypes[1],
            w.outputSlotTypes[2], w.outputSlotTypes[3],
          ] as [number, number, number, number],
          bckPin: w.bckPin,
          mckPin: w.mckPin,
          mckEnabled: w.mckEnabled,
          mckMultiplierEncoded: w.mckMultiplierEncoded,
          clockPinModeP1: w.clockPinModeP1,
          bckPinSlave: w.bckPinSlave,
        };
      })()
    : def.i2s;

  const leveller = layout.leveller
    ? (layout.levellerMasks
        ? (() => {
            const w = Wire.LevellerConfig18.read(r);
            return {
              enabled: w.enabled, speed: w.speed, lookahead: w.lookahead,
              amount: w.amount, maxGainDb: w.maxGainDb, gateDb: w.gateDb,
              detectorMask: w.detectorMask, applyMask: w.applyMask,
            };
          })()
        : (() => {
            const w = Wire.LevellerConfig.read(r);
            return {
              enabled: w.enabled, speed: w.speed, lookahead: w.lookahead,
              amount: w.amount, maxGainDb: w.maxGainDb, gateDb: w.gateDb,
              detectorMask: 0xFF, applyMask: 0xFF,
            };
          })())
    : def.leveller;

  const inputPreampsDb = [...def.inputPreampsDb];
  if (layout.preamp) {
    const w = h.formatVersion >= 16 ? Wire.PreampConfig16.read(r) : Wire.PreampConfig.read(r);
    for (let i = 0; i < w.preampDb.length; i++) inputPreampsDb[i] = w.preampDb[i];
  }
  const masterVol = layout.masterVolume ? Wire.MasterVolume.read(r) : { masterVolumeDb: def.masterVolumeDb };

  const inputConfig = layout.inputSource
    ? (layout.adatInput
        ? (() => {
            const w = Wire.InputConfig24.read(r);
            return {
              source: w.inputSource,
              spdifRxPin: w.spdifRxPin,
              i2sRxPins: [w.i2sRxPin, ...w.i2sRxPinExt],
              i2sInputRateEnc: w.i2sInputRate,
              i2sInputChannels: w.i2sInputChannels,
              spdifRxPinExt: [...w.spdifRxPinExt],
              spdifRxEnabledExtP1: w.spdifRxEnabledExtP1,
              i2sClockMode: w.i2sClockMode,
              adatInputPin: w.adatInputPin,
              adatInputEnabledP1: w.adatInputEnabledP1,
              adatInputClockModeP1: w.adatInputClockModeP1,
            };
          })()
        : layout.i2sClockMode
        ? (() => {
            const w = Wire.InputConfig21.read(r);
            return {
              source: w.inputSource,
              spdifRxPin: w.spdifRxPin,
              i2sRxPins: [w.i2sRxPin, ...w.i2sRxPinExt],
              i2sInputRateEnc: w.i2sInputRate,
              i2sInputChannels: w.i2sInputChannels,
              spdifRxPinExt: [...w.spdifRxPinExt],
              spdifRxEnabledExtP1: w.spdifRxEnabledExtP1,
              i2sClockMode: w.i2sClockMode,
              adatInputPin: 0,
              adatInputEnabledP1: 0,
              adatInputClockModeP1: 0,
            };
          })()
        : (() => {
            const w = Wire.InputConfig.read(r);
            return {
              source: w.inputSource,
              spdifRxPin: w.spdifRxPin,
              i2sRxPins: [w.i2sRxPin, ...w.i2sRxPinExt],
              i2sInputRateEnc: w.i2sInputRate,
              i2sInputChannels: w.i2sInputChannels,
              spdifRxPinExt: [...w.spdifRxPinExt],
              spdifRxEnabledExtP1: w.spdifRxEnabledExtP1,
              i2sClockMode: 0,
              adatInputPin: 0,
              adatInputEnabledP1: 0,
              adatInputClockModeP1: 0,
            };
          })())
    : def.inputConfig;
  const lgSoundSync = layout.lgSoundSync
    ? (() => { const w = Wire.LgSoundSync.read(r); return { enabled: w.enabled, present: w.present, volume: w.volume, muted: w.muted }; })()
    : def.lgSoundSync;
  const userVolume = layout.userVolume
    ? (() => { const w = Wire.UserVolume.read(r); return { volumeDb: w.volumeDb, mute: w.mute }; })()
    : def.userVolume;
  const dacHwMute = layout.dacHwMute
    ? (() => { const w = Wire.DacHwMute.read(r); return { enabled: w.enabled, activeLow: w.activeLow, pin: w.pin, holdMs: w.holdMs, releaseMs: w.releaseMs }; })()
    : def.dacHwMute;

  const crossover = [...def.crossover];
  if (layout.crossover) {
    for (let ch = 0; ch < Wire.Const16.NUM_CHANNELS; ch++) {
      crossover[ch] = Array.from({ length: Wire.Const16.XOVER_BANDS }, () => readWireFilter(r, layout.bandQp));
    }
  }

  const adat = layout.adat
    ? (() => { const w = Wire.AdatConfig.read(r); return { enabled: w.enabled, pin: w.pin }; })()
    : def.adat;

  const psybass = layout.psybass
    ? (() => {
        const w = Wire.PsybassParams.read(r);
        return {
          enabled: w.enabled, outputMask: w.outputMask, cutoffHz: w.cutoffHz,
          harmonicsDb: w.harmonicsDb, driveDb: w.driveDb, characterPct: w.characterPct, originalDb: w.originalDb,
        };
      })()
    : def.psybass;

  const upmix = layout.upmix
    ? (() => {
        const w = Wire.UpmixParams.read(r);
        return {
          enabled: w.enabled, centerMode: w.centerMode, surroundMode: w.surroundMode,
          strengthPct: w.strengthPct, centerWidthPct: w.centerWidthPct, corrThresholdPct: w.corrThresholdPct,
          attackMs: w.attackMs, releaseMs: w.releaseMs, detectorHpfHz: w.detectorHpfHz,
          surroundDelayMs: w.surroundDelayMs, surroundHpfHz: w.surroundHpfHz, surroundLpfHz: w.surroundLpfHz,
          decorrPct: w.decorrPct,
          presenceDb: layout.upmixPresence ? decodePresenceQ1(w.presenceQ1) : 0,
        };
      })()
    : def.upmix;

  return {
    formatVersion: h.formatVersion,
    payloadLength: h.payloadLength,
    platformId:    h.platformId,
    numCh:         h.numCh,
    numOut:        h.numOut,
    numIn:         h.numIn,
    maxBands:      h.maxBands,

    bypass:   g.bypass,
    preampDb: g.preampDb,

    loudness: {
      enabled:      g.loudnessEnabled,
      refSpl:       g.loudnessRefSpl,
      intensityPct: g.loudnessIntensityPct,
      outputMask:   g.loudnessOutputMask,
    },
    crossfeed: {
      enabled: cf.enabled, preset: cf.preset, itd: cf.itd,
      freq: cf.freq, feedDb: cf.feedDb, outputPairMask: cf.outputPairMask,
    },

    delaysMs,
    crosspoints,
    outputs,

    numPinOutputs: pinCfg.numPinOutputs,
    pins:          pinCfg.pins,

    filters,
    channelNames,

    i2s,
    leveller,
    inputPreampsDb,
    masterVolumeDb: masterVol.masterVolumeDb,
    inputConfig,
    lgSoundSync,
    userVolume,
    dacHwMute,
    crossover,
    adat,
    psybass,
    upmix,
  };
}

// Factory: returns a fully-populated BulkParams representing firmware
// factory defaults. Single source of truth for "what's a sensible zero
// state?" -- used by tests, MockTransport, and the parser's section fallback.
export function defaultBulkParams(opts: {
  platformId: number;
  numCh: number;
  numOut: number;
  numIn?: number;
  maxBands?: number;
  formatVersion?: number;
}): BulkParams {
  const numIn = opts.numIn ?? Wire.Const.NUM_INPUTS;
  const maxBands = opts.maxBands ?? Wire.Const.BANDS_MAX;
  const formatVersion = opts.formatVersion ?? 10;
  return {
    formatVersion,
    payloadLength: Wire.bulkSizeForVersion(formatVersion),
    platformId:    opts.platformId,
    numCh:         opts.numCh,
    numOut:        opts.numOut,
    numIn,
    maxBands,

    bypass: false,
    preampDb: 0,

    loudness:  { enabled: false, refSpl: 85, intensityPct: 0, outputMask: 0xFFFF },
    crossfeed: { enabled: false, preset: 0, itd: false, freq: 700, feedDb: 4.5, outputPairMask: 0x01 },

    delaysMs: Array.from({ length: Wire.Const16.NUM_CHANNELS }, () => 0),

    crosspoints: Array.from({ length: Wire.Const16.NUM_INPUTS }, () =>
      Array.from({ length: Wire.Const.NUM_OUTPUTS }, () =>
        ({ enabled: false, invert: false, gainDb: 0 }))),

    outputs: Array.from({ length: Wire.Const.NUM_OUTPUTS }, () =>
      ({ enabled: false, muted: false, gainDb: 0, delayMs: 0 })),

    numPinOutputs: 0,
    pins:          Array.from({ length: Wire.Const.NUM_PIN_OUTPUTS }, () => 0),

    filters: Array.from({ length: Wire.Const16.NUM_CHANNELS }, () =>
      Array.from({ length: Wire.Const.BANDS_MAX }, defaultWireFilter)),

    channelNames: Array.from({ length: Wire.Const16.NUM_CHANNELS }, () => ''),

    i2s: {
      outputSlotTypes: [0, 0, 0, 0] as [number, number, number, number],
      bckPin: 0,
      mckPin: 0,
      mckEnabled: false,
      mckMultiplierEncoded: 0,
      clockPinModeP1: 0,
      bckPinSlave: 0,
    },
    leveller: { enabled: false, speed: 0, lookahead: false, amount: 0, maxGainDb: 0, gateDb: -40, detectorMask: 0xFF, applyMask: 0xFF },
    inputPreampsDb: Array.from({ length: Wire.Const16.NUM_INPUTS }, () => 0),
    masterVolumeDb: 0,
    inputConfig: {
      source: 0, spdifRxPin: 5, i2sRxPins: [0, 0, 0, 0], i2sInputRateEnc: 1, i2sInputChannels: 0,
      spdifRxPinExt: [0, 0], spdifRxEnabledExtP1: 0, i2sClockMode: 0,
      adatInputPin: 0, adatInputEnabledP1: 0, adatInputClockModeP1: 0,
    },
    lgSoundSync: { enabled: false, present: false, volume: 0, muted: false },
    userVolume:  { volumeDb: 0, mute: false },
    dacHwMute:   { enabled: false, activeLow: false, pin: 11, holdMs: 0, releaseMs: 0 },
    crossover: Array.from({ length: Wire.Const16.NUM_CHANNELS }, () =>
      Array.from({ length: Wire.Const16.XOVER_BANDS }, defaultWireFilter)),
    adat: { enabled: false, pin: 0 },
    psybass: { enabled: false, outputMask: 0xFFFF, cutoffHz: 80, harmonicsDb: 0, driveDb: 6, characterPct: 50, originalDb: 0 },
    upmix: {
      enabled: false, centerMode: 1, surroundMode: 2,
      strengthPct: 100, centerWidthPct: 25, corrThresholdPct: 30,
      attackMs: 10, releaseMs: 100, detectorHpfHz: 200,
      surroundDelayMs: 12, surroundHpfHz: 300, surroundLpfHz: 7000,
      decorrPct: 90, presenceDb: 0,
    },
  };
}

// Total writer. Emits at `version` (default: the snapshot's own wire version,
// clamped to [6, MAX_WIRE_VERSION]). A V10 device thus receives a V10 packet
// and a V16 device its full 5864-byte packet (V16 firmware accepts nothing
// shorter). Versions 11..15 collapse to V10. The pre-V16 firmware merges
// shorter packets, so passing an explicit lower version is a safe
// down-convert for older devices.
export function buildBulkParams(bulk: BulkParams, version?: number): Uint8Array {
  if (bulk.formatVersion < 6) {
    throw new Error(`buildBulkParams: snapshot formatVersion ${bulk.formatVersion} is below the V6 floor`);
  }
  const requested = Math.min(version ?? bulk.formatVersion, Wire.MAX_WIRE_VERSION);
  const writeVersion = requested >= 16 ? requested : Math.min(requested, 10);
  const dims = Wire.dimsForVersion(writeVersion);
  const size = Wire.bulkSizeForVersion(writeVersion);
  const w = new BinWriter(size);

  Wire.Header.write(w, {
    formatVersion: writeVersion,
    platformId:    bulk.platformId,
    numCh:         bulk.numCh,
    numOut:        bulk.numOut,
    numIn:         bulk.numIn,
    maxBands:      bulk.maxBands,
    payloadLength: size,
  });

  if (writeVersion >= 19) {
    Wire.GlobalParams19.write(w, {
      preampDb:             bulk.preampDb,
      bypass:               bulk.bypass,
      loudnessEnabled:      bulk.loudness.enabled,
      loudnessOutputMask:   bulk.loudness.outputMask,
      loudnessRefSpl:       bulk.loudness.refSpl,
      loudnessIntensityPct: bulk.loudness.intensityPct,
    });
  } else {
    Wire.GlobalParams.write(w, {
      preampDb:             bulk.preampDb,
      bypass:               bulk.bypass,
      loudnessEnabled:      bulk.loudness.enabled,
      loudnessRefSpl:       bulk.loudness.refSpl,
      loudnessIntensityPct: bulk.loudness.intensityPct,
    });
  }

  if (writeVersion >= 20) {
    Wire.CrossfeedParams20.write(w, {
      enabled: bulk.crossfeed.enabled,
      preset:  bulk.crossfeed.preset,
      itd:     bulk.crossfeed.itd,
      outputPairMask: bulk.crossfeed.outputPairMask,
      freq:    bulk.crossfeed.freq,
      feedDb:  bulk.crossfeed.feedDb,
    });
  } else {
    Wire.CrossfeedParams.write(w, {
      enabled: bulk.crossfeed.enabled,
      preset:  bulk.crossfeed.preset,
      itd:     bulk.crossfeed.itd,
      freq:    bulk.crossfeed.freq,
      feedDb:  bulk.crossfeed.feedDb,
    });
  }

  Wire.LegacyChannels.write(w, undefined);
  for (let i = 0; i < dims.numCh; i++) Codec.f32.write(w, bulk.delaysMs[i] ?? 0);

  for (let inp = 0; inp < dims.numIn; inp++) {
    for (let outp = 0; outp < Wire.Const.NUM_OUTPUTS; outp++) {
      const cp = bulk.crosspoints[inp][outp];
      Wire.Crosspoint.write(w, { enabled: cp.enabled, invert: cp.invert, gainDb: cp.gainDb });
    }
  }

  for (let o = 0; o < Wire.Const.NUM_OUTPUTS; o++) {
    const out = bulk.outputs[o];
    Wire.OutputChannel.write(w, { enabled: out.enabled, muted: out.muted, gainDb: out.gainDb, delayMs: out.delayMs });
  }

  Wire.PinConfig.write(w, { numPinOutputs: bulk.numPinOutputs, pins: bulk.pins });

  const withBandQp = writeVersion >= 22;
  for (let ch = 0; ch < dims.numCh; ch++) {
    for (let b = 0; b < Wire.Const.BANDS_MAX; b++) {
      writeWireFilter(w, bulk.filters[ch][b], withBandQp);
    }
  }

  for (let ch = 0; ch < dims.numCh; ch++) Wire.ChannelName.write(w, bulk.channelNames[ch] ?? '');

  // V6 tail -- always present (writeVersion >= 6).
  Wire.I2SConfig.write(w, bulk.i2s);
  if (writeVersion >= 18) {
    Wire.LevellerConfig18.write(w, bulk.leveller);
  } else {
    Wire.LevellerConfig.write(w, bulk.leveller);
  }
  if (writeVersion >= 16) {
    Wire.PreampConfig16.write(w, { preampDb: bulk.inputPreampsDb.slice(0, Wire.Const16.NUM_INPUTS) });
  } else {
    Wire.PreampConfig.write(w, { preampDb: bulk.inputPreampsDb.slice(0, Wire.Const.NUM_INPUTS) });
  }
  Wire.MasterVolume.write(w, { masterVolumeDb: bulk.masterVolumeDb });

  // V7-V16 tail -- written only when the target version includes the section.
  if (writeVersion >= 24) {
    Wire.InputConfig24.write(w, {
      inputSource:         bulk.inputConfig.source,
      spdifRxPin:          bulk.inputConfig.spdifRxPin,
      i2sRxPin:            bulk.inputConfig.i2sRxPins[0] ?? 0,
      i2sInputRate:        bulk.inputConfig.i2sInputRateEnc,
      i2sInputChannels:    bulk.inputConfig.i2sInputChannels,
      i2sRxPinExt:         bulk.inputConfig.i2sRxPins.slice(1, 4),
      spdifRxPinExt:       bulk.inputConfig.spdifRxPinExt,
      spdifRxEnabledExtP1: bulk.inputConfig.spdifRxEnabledExtP1,
      i2sClockMode:        bulk.inputConfig.i2sClockMode,
      adatInputPin:         bulk.inputConfig.adatInputPin,
      adatInputEnabledP1:   bulk.inputConfig.adatInputEnabledP1,
      adatInputClockModeP1: bulk.inputConfig.adatInputClockModeP1,
    });
  } else if (writeVersion >= 21) {
    Wire.InputConfig21.write(w, {
      inputSource:         bulk.inputConfig.source,
      spdifRxPin:          bulk.inputConfig.spdifRxPin,
      i2sRxPin:            bulk.inputConfig.i2sRxPins[0] ?? 0,
      i2sInputRate:        bulk.inputConfig.i2sInputRateEnc,
      i2sInputChannels:    bulk.inputConfig.i2sInputChannels,
      i2sRxPinExt:         bulk.inputConfig.i2sRxPins.slice(1, 4),
      spdifRxPinExt:       bulk.inputConfig.spdifRxPinExt,
      spdifRxEnabledExtP1: bulk.inputConfig.spdifRxEnabledExtP1,
      i2sClockMode:        bulk.inputConfig.i2sClockMode,
    });
  } else if (writeVersion >= 7) {
    Wire.InputConfig.write(w, {
      inputSource:         bulk.inputConfig.source,
      spdifRxPin:          bulk.inputConfig.spdifRxPin,
      i2sRxPin:            bulk.inputConfig.i2sRxPins[0] ?? 0,
      i2sInputRate:        bulk.inputConfig.i2sInputRateEnc,
      i2sInputChannels:    bulk.inputConfig.i2sInputChannels,
      i2sRxPinExt:         bulk.inputConfig.i2sRxPins.slice(1, 4),
      spdifRxPinExt:       bulk.inputConfig.spdifRxPinExt,
      spdifRxEnabledExtP1: bulk.inputConfig.spdifRxEnabledExtP1,
    });
  }
  if (writeVersion >= 8) {
    Wire.LgSoundSync.write(w, { enabled: bulk.lgSoundSync.enabled, present: bulk.lgSoundSync.present, volume: bulk.lgSoundSync.volume, muted: bulk.lgSoundSync.muted });
  }
  if (writeVersion >= 9) {
    Wire.UserVolume.write(w, { volumeDb: bulk.userVolume.volumeDb, mute: bulk.userVolume.mute });
  }
  if (writeVersion >= 10) {
    Wire.DacHwMute.write(w, { enabled: bulk.dacHwMute.enabled, activeLow: bulk.dacHwMute.activeLow, pin: bulk.dacHwMute.pin, holdMs: bulk.dacHwMute.holdMs, releaseMs: bulk.dacHwMute.releaseMs });
  }
  if (writeVersion >= 16) {
    for (let ch = 0; ch < Wire.Const16.NUM_CHANNELS; ch++) {
      for (let b = 0; b < Wire.Const16.XOVER_BANDS; b++) {
        writeWireFilter(w, bulk.crossover[ch][b], withBandQp);
      }
    }
  }
  if (writeVersion >= 17) {
    Wire.AdatConfig.write(w, { enabled: bulk.adat.enabled, pin: bulk.adat.pin });
  }
  if (writeVersion >= 23) {
    Wire.PsybassParams.write(w, {
      enabled: bulk.psybass.enabled, outputMask: bulk.psybass.outputMask, cutoffHz: bulk.psybass.cutoffHz,
      harmonicsDb: bulk.psybass.harmonicsDb, driveDb: bulk.psybass.driveDb,
      characterPct: bulk.psybass.characterPct, originalDb: bulk.psybass.originalDb,
    });
  }
  if (writeVersion >= 25) {
    Wire.UpmixParams.write(w, {
      enabled: bulk.upmix.enabled, centerMode: bulk.upmix.centerMode, surroundMode: bulk.upmix.surroundMode,
      presenceQ1: writeVersion >= 26 ? encodePresenceQ1(bulk.upmix.presenceDb) : 0,
      strengthPct: bulk.upmix.strengthPct, centerWidthPct: bulk.upmix.centerWidthPct, corrThresholdPct: bulk.upmix.corrThresholdPct,
      attackMs: bulk.upmix.attackMs, releaseMs: bulk.upmix.releaseMs, detectorHpfHz: bulk.upmix.detectorHpfHz,
      surroundDelayMs: bulk.upmix.surroundDelayMs, surroundHpfHz: bulk.upmix.surroundHpfHz, surroundLpfHz: bulk.upmix.surroundLpfHz,
      decorrPct: bulk.upmix.decorrPct,
    });
  }

  return w.toUint8Array();
}
