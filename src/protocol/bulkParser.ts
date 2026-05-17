// Bulk packet parser.  Wire layout codecs live in `./wireTypes.ts`,
// mirroring docs/bulk_params.h.  This file maps those wire structs onto
// the `BulkParams` DTO and gates optional sections by version and buffer
// length.
//
// The synthesizer side is in `./bulkParser.syn.ts`.

import { BinReader, Codec } from '../utils';
import * as Wire from './wireTypes';
import type { CrossfeedPreset, LevellerSpeed, Loudness, Crossfeed, Leveller } from '../domain/processing';
import type { CrossPoint, OutputState } from '../domain/mixer';
import type { I2sConfig, PlatformType } from '../domain/platform';

// The parsed bulk packet as a plain DTO. Fields mirror bulk_params.h
// section by section. Optional sections (i2s, leveller, preamp, master
// volume) are null when the firmware version or response length omits
// them.
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

export interface BulkParams {
  formatVersion: number;
  platformId: PlatformType;
  numCh: number;
  numOut: number;
  numIn: number;
  maxBands: number;

  bypass: boolean;
  preampDb: number;

  loudness: Loudness;
  crossfeed: Crossfeed;

  delaysMs: number[];                 // length 11
  crosspoints: CrossPoint[][];        // [2][9]
  outputs: OutputState[];             // length 9

  numPinOutputs: number;
  pins: number[];                     // length 5

  filters: WireFilter[][];            // [11][12], raw wire shape
  channelNames: string[];             // length 11

  i2s: I2sConfig | null;
  leveller: Leveller | null;

  preampLDb: number | null;           // V6+
  preampRDb: number | null;
  masterVolumeDb: number | null;      // V6+
}

// Static byte sizes of the V6 data portions (before reserved padding).
const PREAMP_DATA_BYTES     = Codec.sizeOf(Wire.PreampConfig);   // 8
const MASTER_VOL_DATA_BYTES = Codec.sizeOf(Wire.MasterVolume);   // 4

export function parseBulkParams(buffer: Uint8Array): BulkParams {
  if (buffer.length < Wire.BulkLimits.MinPacketSize) {
    throw new Error(
      `bulk packet too small: got ${buffer.length}, need at least ${Wire.BulkLimits.MinPacketSize}.`,
    );
  }
  const r = new BinReader(buffer);

  const h  = Wire.Header.read(r);
  const formatVersion = h.formatVersion;
  const platformId    = (h.platformId === 1 ? 1 : 0) as PlatformType;

  const g  = Wire.GlobalParams.read(r);
  const cf = Wire.CrossfeedParams.read(r);

  Wire.LegacyChannels.read(r); // 16 B, ignored

  const delaysMs = Wire.ChannelDelays.read(r);

  // Crosspoints are stored input-major / output-minor on the wire.
  const crosspoints = Array.from({ length: Wire.Const.NUM_INPUTS }, () =>
    Array.from({ length: Wire.Const.NUM_OUTPUTS }, () => Wire.Crosspoint.read(r)),
  );

  const outputs = Array.from({ length: Wire.Const.NUM_OUTPUTS }, () => Wire.OutputChannel.read(r));

  const pinCfg = Wire.PinConfig.read(r);

  // EQ is channel-major / band-minor.
  const filters: WireFilter[][] = Array.from({ length: Wire.Const.NUM_CHANNELS }, () =>
    Array.from({ length: Wire.Const.BANDS_MAX }, () => {
      const b = Wire.BandParams.read(r);
      return { type: b.type, frequency: b.frequency, q: b.q, gain: b.gain };
    }),
  );

  const channelNames = Wire.ChannelNames.read(r);

  // Optional tail
  const i2s = r.remaining >= 16
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
    : null;

  const leveller = r.remaining >= 16
    ? (() => {
        const w = Wire.LevellerConfig.read(r);
        const speed = (w.speed === 1 || w.speed === 2 ? w.speed : 0) as LevellerSpeed;
        return {
          enabled: w.enabled, speed, lookahead: w.lookahead,
          amount: w.amount, maxGainDb: w.maxGainDb, gateDb: w.gateDb,
        };
      })()
    : null;

  // V6+ sections live at fixed absolute offsets with reserved padding
  // separating them; seek explicitly rather than relying on the cursor.
  let preampLDb: number | null = null;
  let preampRDb: number | null = null;
  if (formatVersion >= 6 && buffer.length >= Wire.BulkOffsets.PerChPreamp + PREAMP_DATA_BYTES) {
    r.seek(Wire.BulkOffsets.PerChPreamp);
    const p = Wire.PreampConfig.read(r);
    preampLDb = p.preampDb[0];
    preampRDb = p.preampDb[1];
  }

  let masterVolumeDb: number | null = null;
  if (formatVersion >= 6 && buffer.length >= Wire.BulkOffsets.MasterVolume + MASTER_VOL_DATA_BYTES) {
    r.seek(Wire.BulkOffsets.MasterVolume);
    masterVolumeDb = Wire.MasterVolume.read(r).masterVolumeDb;
  }

  return {
    formatVersion, platformId,
    numCh: h.numCh, numOut: h.numOut, numIn: h.numIn, maxBands: h.maxBands,
    bypass: g.bypass,
    preampDb: g.preampDb,
    loudness: {
      enabled:      g.loudnessEnabled,
      refSpl:       g.loudnessRefSpl,
      intensityPct: g.loudnessIntensityPct,
    },
    crossfeed: {
      enabled: cf.enabled, preset: cf.preset as CrossfeedPreset, itd: cf.itd,
      freq:    cf.freq,    feedDb: cf.feedDb,
      // TODO: narrow cf.preset with a validator helper (see narrowFilterType
      // pattern in bulkToSnapshot.ts) instead of casting at the wire boundary.
    },
    delaysMs, crosspoints, outputs,
    numPinOutputs: pinCfg.numPinOutputs,
    pins:          pinCfg.pins,
    filters, channelNames,
    i2s, leveller,
    preampLDb, preampRDb, masterVolumeDb,
  };
}
