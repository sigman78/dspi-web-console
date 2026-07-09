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
  Loudness,
  CrossPoint, OutputState,
  I2sConfig,
} from '@/domain';

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

  i2s: I2sConfig;
  leveller: WireLeveller;

  inputPreampsDb: number[];           // length 8 (V10 fills 2)
  masterVolumeDb: number;             // V6+

  inputConfig: WireInputConfig;       // V7+ (i2s fields V16+)
  lgSoundSync: WireLgSoundSync;       // V8+
  userVolume:  WireUserVolume;        // V9+
  dacHwMute:   WireDacHwMute;         // V10+

  crossover: WireFilter[][];          // [17][4], V16+ (flat defaults on V10)
  adat: WireAdat;                     // V17+
}

function defaultWireFilter(): WireFilter {
  return { type: 0, bypass: false, frequency: 1000, q: 1, gain: 0 };
}

function readWireFilter(r: BinReader): WireFilter {
  const b = Wire.BandParams.read(r);
  return { type: b.type, bypass: b.bypass === 1, frequency: b.frequency, q: b.q, gain: b.gain };
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

  const g  = Wire.GlobalParams.read(r);
  const cf = Wire.CrossfeedParams.read(r);

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
    filters[ch] = Array.from({ length: Wire.Const.BANDS_MAX }, () => readWireFilter(r));
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
    ? (() => {
        const w = Wire.InputConfig.read(r);
        return {
          source: w.inputSource,
          spdifRxPin: w.spdifRxPin,
          i2sRxPins: [w.i2sRxPin, ...w.i2sRxPinExt],
          i2sInputRateEnc: w.i2sInputRate,
          i2sInputChannels: w.i2sInputChannels,
          spdifRxPinExt: [...w.spdifRxPinExt],
          spdifRxEnabledExtP1: w.spdifRxEnabledExtP1,
        };
      })()
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
      crossover[ch] = Array.from({ length: Wire.Const16.XOVER_BANDS }, () => readWireFilter(r));
    }
  }

  const adat = layout.adat
    ? (() => { const w = Wire.AdatConfig.read(r); return { enabled: w.enabled, pin: w.pin }; })()
    : def.adat;

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
    },
    crossfeed: {
      enabled: cf.enabled, preset: cf.preset, itd: cf.itd,
      freq: cf.freq, feedDb: cf.feedDb,
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

    loudness:  { enabled: false, refSpl: 85, intensityPct: 0 },
    crossfeed: { enabled: false, preset: 0, itd: false, freq: 700, feedDb: 4.5 },

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
    },
    leveller: { enabled: false, speed: 0, lookahead: false, amount: 0, maxGainDb: 0, gateDb: -40, detectorMask: 0xFF, applyMask: 0xFF },
    inputPreampsDb: Array.from({ length: Wire.Const16.NUM_INPUTS }, () => 0),
    masterVolumeDb: 0,
    inputConfig: { source: 0, spdifRxPin: 5, i2sRxPins: [0, 0, 0, 0], i2sInputRateEnc: 1, i2sInputChannels: 0, spdifRxPinExt: [0, 0], spdifRxEnabledExtP1: 0 },
    lgSoundSync: { enabled: false, present: false, volume: 0, muted: false },
    userVolume:  { volumeDb: 0, mute: false },
    dacHwMute:   { enabled: false, activeLow: false, pin: 11, holdMs: 0, releaseMs: 0 },
    crossover: Array.from({ length: Wire.Const16.NUM_CHANNELS }, () =>
      Array.from({ length: Wire.Const16.XOVER_BANDS }, defaultWireFilter)),
    adat: { enabled: false, pin: 0 },
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

  Wire.GlobalParams.write(w, {
    preampDb:             bulk.preampDb,
    bypass:               bulk.bypass,
    loudnessEnabled:      bulk.loudness.enabled,
    loudnessRefSpl:       bulk.loudness.refSpl,
    loudnessIntensityPct: bulk.loudness.intensityPct,
  });

  Wire.CrossfeedParams.write(w, {
    enabled: bulk.crossfeed.enabled,
    preset:  bulk.crossfeed.preset,
    itd:     bulk.crossfeed.itd,
    freq:    bulk.crossfeed.freq,
    feedDb:  bulk.crossfeed.feedDb,
  });

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

  for (let ch = 0; ch < dims.numCh; ch++) {
    for (let b = 0; b < Wire.Const.BANDS_MAX; b++) {
      const f = bulk.filters[ch][b];
      Wire.BandParams.write(w, { type: f.type, bypass: f.bypass ? 1 : 0, frequency: f.frequency, q: f.q, gain: f.gain });
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
  if (writeVersion >= 7) {
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
        const f = bulk.crossover[ch][b];
        Wire.BandParams.write(w, { type: f.type, bypass: f.bypass ? 1 : 0, frequency: f.frequency, q: f.q, gain: f.gain });
      }
    }
  }
  if (writeVersion >= 17) {
    Wire.AdatConfig.write(w, { enabled: bulk.adat.enabled, pin: bulk.adat.pin });
  }

  return w.toUint8Array();
}
