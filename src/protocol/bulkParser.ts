// Bulk packet parser.  Wire layout codecs live in `./wireTypes.ts`,
// mirroring docs/bulk_params.h.  This file maps those wire structs onto
// the `BulkParams` DTO and gates optional sections by version and buffer
// length.
//
// The synthesizer side is in `./bulkParser.syn.ts`.

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
// in domain/bulkToSnapshot.ts when assembling DspSnapshot.
export interface WireFilter {
  type: number;
  frequency: number;
  q: number;
  gain: number;
}

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
      return { type: b.type, frequency: b.frequency, q: b.q, gain: b.gain };
    }),
  );

  const channelNames = Wire.ChannelNames.read(r);

  // Optional V6 tail sections — read if present, else use factory defaults.
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

  return {
    formatVersion: h.formatVersion,
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
  };
}

// Factory: returns a fully-populated BulkParams representing firmware
// factory defaults. Single source of truth for "what's a sensible zero
// state?" — used by tests, MockTransport, the parser's section fallback
// (Task 4), and toBulkParams in the domain layer (later).
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
        ({ type: 0, frequency: 1000, q: 1, gain: 0 }))),

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
  };
}

// Strict total writer. Symmetric inverse of parseBulkParams. Emits V6
// (2896 bytes). Throws on non-V6 input — the writer doesn't support
// older versions. SET_ALL_PARAMS firmware-side requires exact V6 size.
export function buildBulkParams(bulk: BulkParams): Uint8Array {
  if (bulk.formatVersion !== 6) {
    throw new Error(`buildBulkParams: only formatVersion=6 supported, got ${bulk.formatVersion}`);
  }
  const w = new BinWriter(Wire.BulkLimits.MaxRequestSize);

  Wire.Header.write(w, {
    formatVersion: 6,
    platformId:    bulk.platformId,
    numCh:         bulk.numCh,
    numOut:        bulk.numOut,
    numIn:         bulk.numIn,
    maxBands:      bulk.maxBands,
    payloadLength: Wire.BulkLimits.MaxRequestSize,  // V6 full = 2896
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
      Wire.BandParams.write(w, { type: f.type, frequency: f.frequency, q: f.q, gain: f.gain });
    }
  }

  Wire.ChannelNames.write(w, bulk.channelNames);

  // V6 trailing sections — sequential writes; no seeks needed because
  // codecs are 16 B each (Task 1) and the required sections are all present.
  Wire.I2SConfig.write(w, bulk.i2s);
  Wire.LevellerConfig.write(w, bulk.leveller);
  Wire.PreampConfig.write(w, { preampDb: [bulk.preampLDb, bulk.preampRDb] });
  Wire.MasterVolume.write(w, { masterVolumeDb: bulk.masterVolumeDb });

  return w.toUint8Array();
}
