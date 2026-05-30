// Bulk packet parser.  Wire layout codecs live in `./wireTypes.ts`,
// mirroring docs/bulk_params.h.  This file maps those wire structs onto
// the `BulkParams` DTO and gates optional sections by version and buffer
// length.

import { BinReader, BinWriter } from '@/utils';
import * as Wire from './wireTypes';
import type {
  Loudness,
  CrossPoint, OutputState,
  I2sConfig,
} from '@/domain';

// The parsed bulk packet as a plain DTO. Fields mirror bulk_params.h
// section by section. All sections are populated. When the wire packet omits
// an optional V6 section (older firmware), the parser substitutes values from
// defaultBulkParams(). The formatVersion field is preserved so downstream
// consumers (e.g. fromBulkParams) can decide whether to surface those as null
// in their own DTOs.
//
// Filters are typed as raw wire shape (WireFilter: {type: number, ...})
// rather than FilterParams[][] so this file has zero domain imports for
// filter concerns. The narrowing of `type: number` -> `FilterType` happens
// in device/snapshotCodec.ts when assembling DspSnapshot.
export interface WireFilter {
  type: number;
  bypass: boolean;
  frequency: number;
  q: number;
  gain: number;
}

export interface WireInputConfig { source: number; spdifRxPin: number; }
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

  delaysMs: number[];                 // length 11
  crosspoints: CrossPoint[][];        // [2][9]
  outputs: OutputState[];             // length 9

  numPinOutputs: number;
  pins: number[];                     // length 5

  filters: WireFilter[][];            // [11][12], raw wire shape
  channelNames: string[];             // length 11

  i2s: I2sConfig;
  leveller: WireLeveller;

  preampLDb: number;                  // V6+
  preampRDb: number;
  masterVolumeDb: number;             // V6+

  inputConfig: WireInputConfig;       // V7+
  lgSoundSync: WireLgSoundSync;       // V8+
  userVolume:  WireUserVolume;        // V9+
  dacHwMute:   WireDacHwMute;         // V10+
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

  const delaysMs = Wire.ChannelDelays.read(r);

  const crosspoints = Array.from({ length: Wire.Const.NUM_INPUTS }, () =>
    Array.from({ length: Wire.Const.NUM_OUTPUTS }, () => Wire.Crosspoint.read(r)),
  );

  const outputs = Array.from({ length: Wire.Const.NUM_OUTPUTS }, () => Wire.OutputChannel.read(r));

  const pinCfg = Wire.PinConfig.read(r);

  const filters: WireFilter[][] = Array.from({ length: Wire.Const.NUM_CHANNELS }, () =>
    Array.from({ length: Wire.Const.BANDS_MAX }, () => {
      const b = Wire.BandParams.read(r);
      return { type: b.type, bypass: b.bypass === 1, frequency: b.frequency, q: b.q, gain: b.gain };
    }),
  );

  const channelNames = Wire.ChannelNames.read(r);

  // Optional V6 tail sections -- read if present, else use factory defaults.
  // Codecs are 16 B each (Task 1), so sequential reads line up with on-wire offsets.
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
    ? (() => {
        const w = Wire.LevellerConfig.read(r);
        return {
          enabled: w.enabled, speed: w.speed, lookahead: w.lookahead,
          amount: w.amount, maxGainDb: w.maxGainDb, gateDb: w.gateDb,
        };
      })()
    : def.leveller;

  const preamp = layout.preamp ? Wire.PreampConfig.read(r) : { preampDb: [def.preampLDb, def.preampRDb] };
  const masterVol = layout.masterVolume ? Wire.MasterVolume.read(r) : { masterVolumeDb: def.masterVolumeDb };

  const inputConfig = layout.inputSource
    ? (() => { const w = Wire.InputConfig.read(r); return { source: w.inputSource, spdifRxPin: w.spdifRxPin }; })()
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
    preampLDb: preamp.preampDb[0],
    preampRDb: preamp.preampDb[1],
    masterVolumeDb: masterVol.masterVolumeDb,
    inputConfig,
    lgSoundSync,
    userVolume,
    dacHwMute,
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
}): BulkParams {
  const numIn = opts.numIn ?? Wire.Const.NUM_INPUTS;
  const maxBands = opts.maxBands ?? Wire.Const.BANDS_MAX;
  return {
    formatVersion: 6,
    payloadLength: Wire.BulkSizes.V6Full,
    platformId:    opts.platformId,
    numCh:         opts.numCh,
    numOut:        opts.numOut,
    numIn,
    maxBands,

    bypass: false,
    preampDb: 0,

    loudness:  { enabled: false, refSpl: 85, intensityPct: 0 },
    crossfeed: { enabled: false, preset: 0, itd: false, freq: 700, feedDb: 4.5 },

    delaysMs: Array.from({ length: Wire.Const.NUM_CHANNELS }, () => 0),

    crosspoints: Array.from({ length: Wire.Const.NUM_INPUTS }, () =>
      Array.from({ length: Wire.Const.NUM_OUTPUTS }, () =>
        ({ enabled: false, invert: false, gainDb: 0 }))),

    outputs: Array.from({ length: Wire.Const.NUM_OUTPUTS }, () =>
      ({ enabled: false, muted: false, gainDb: 0, delayMs: 0 })),

    numPinOutputs: 0,
    pins:          Array.from({ length: Wire.Const.NUM_PIN_OUTPUTS }, () => 0),

    filters: Array.from({ length: Wire.Const.NUM_CHANNELS }, () =>
      Array.from({ length: Wire.Const.BANDS_MAX }, () =>
        ({ type: 0, bypass: false, frequency: 1000, q: 1, gain: 0 }))),

    channelNames: Array.from({ length: Wire.Const.NUM_CHANNELS }, () => ''),

    i2s: {
      outputSlotTypes: [0, 0, 0, 0] as [number, number, number, number],
      bckPin: 0,
      mckPin: 0,
      mckEnabled: false,
      mckMultiplierEncoded: 0,
    },
    leveller: { enabled: false, speed: 0, lookahead: false, amount: 0, maxGainDb: 0, gateDb: -40 },
    preampLDb: 0,
    preampRDb: 0,
    masterVolumeDb: 0,
    inputConfig: { source: 0, spdifRxPin: 5 },
    lgSoundSync: { enabled: false, present: false, volume: 0, muted: false },
    userVolume:  { volumeDb: 0, mute: false },
    dacHwMute:   { enabled: false, activeLow: false, pin: 11, holdMs: 0, releaseMs: 0 },
  };
}

// Total writer. Emits at `version` (default: the snapshot's own wire version,
// clamped to [6, MAX_WIRE_VERSION]). A V6 device thus receives a V6 packet; a
// V10 device round-trips its full tail. The firmware merges shorter packets, so
// passing an explicit lower version is a safe down-convert for older devices.
export function buildBulkParams(bulk: BulkParams, version?: number): Uint8Array {
  if (bulk.formatVersion < 6) {
    throw new Error(`buildBulkParams: snapshot formatVersion ${bulk.formatVersion} is below the V6 floor`);
  }
  const writeVersion = Math.min(version ?? bulk.formatVersion, Wire.MAX_WIRE_VERSION);
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
  Wire.ChannelDelays.write(w, bulk.delaysMs);

  for (let inp = 0; inp < Wire.Const.NUM_INPUTS; inp++) {
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

  for (let ch = 0; ch < Wire.Const.NUM_CHANNELS; ch++) {
    for (let b = 0; b < Wire.Const.BANDS_MAX; b++) {
      const f = bulk.filters[ch][b];
      Wire.BandParams.write(w, { type: f.type, bypass: f.bypass ? 1 : 0, frequency: f.frequency, q: f.q, gain: f.gain });
    }
  }

  Wire.ChannelNames.write(w, bulk.channelNames);

  // V6 tail — always present (writeVersion >= 6).
  Wire.I2SConfig.write(w, bulk.i2s);
  Wire.LevellerConfig.write(w, bulk.leveller);
  Wire.PreampConfig.write(w, { preampDb: [bulk.preampLDb, bulk.preampRDb] });
  Wire.MasterVolume.write(w, { masterVolumeDb: bulk.masterVolumeDb });

  // V7-V10 tail — written only when the target version includes the section.
  if (writeVersion >= 7) {
    Wire.InputConfig.write(w, { inputSource: bulk.inputConfig.source, spdifRxPin: bulk.inputConfig.spdifRxPin });
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

  return w.toUint8Array();
}
