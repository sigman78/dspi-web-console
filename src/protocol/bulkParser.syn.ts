// Synthesizer side of the bulk packet: encodes a `SynthesizeOptions`
// shape into the canonical wire bytes. Used by tests to build round-trip
// fixtures and by `MockTransport` to serve `GetAllParams` without hardware.
// The parser lives in `./bulkParser.ts`; both sides share the wire schemas
// in `./wireTypes.ts`.

import type { BulkParams } from './bulkParser';
import { BinWriter } from '@/utils';
import * as Wire from './wireTypes';

export interface SynthesizeOptions extends Partial<Omit<BulkParams, 'channelNames'>> {
  channelNames?: string[];
  // Total packet size; defaults to enough to include master volume (V6)
  packetSize?: number;
}

export function synthesizeBulkParams(opts: SynthesizeOptions = {}): Uint8Array {
  const formatVersion = opts.formatVersion ?? 6;
  const platformId    = opts.platformId ?? 1;
  const numCh         = opts.numCh ?? Wire.Const.NUM_CHANNELS;
  const numOut        = opts.numOut ?? (platformId === 1 ? 9 : 5);
  const numIn         = opts.numIn ?? 2;
  const maxBands      = opts.maxBands ?? Wire.Const.BANDS_MAX;

  const wantSize = opts.packetSize ?? Wire.BulkLimits.MaxRequestSize;
  const w = new BinWriter(wantSize);

  Wire.Header.write(w, {
    formatVersion, platformId, numCh, numOut, numIn, maxBands,
    payloadLength: wantSize,
  });

  Wire.GlobalParams.write(w, {
    preampDb:             opts.preampDb ?? 0,
    bypass:               opts.bypass ?? false,
    loudnessEnabled:      opts.loudness?.enabled ?? false,
    loudnessRefSpl:       opts.loudness?.refSpl ?? 0,
    loudnessIntensityPct: opts.loudness?.intensityPct ?? 0,
  });

  Wire.CrossfeedParams.write(w, {
    enabled: opts.crossfeed?.enabled ?? false,
    preset:  opts.crossfeed?.preset  ?? 0,
    itd:     opts.crossfeed?.itd     ?? false,
    freq:    opts.crossfeed?.freq    ?? 0,
    feedDb:  opts.crossfeed?.feedDb  ?? 0,
  });

  Wire.LegacyChannels.write(w, undefined);

  Wire.ChannelDelays.write(
    w,
    Array.from({ length: Wire.Const.NUM_CHANNELS }, (_, i) => opts.delaysMs?.[i] ?? 0),
  );

  for (let inp = 0; inp < Wire.Const.NUM_INPUTS; inp++) {
    for (let outp = 0; outp < Wire.Const.NUM_OUTPUTS; outp++) {
      const cp = opts.crosspoints?.[inp]?.[outp];
      Wire.Crosspoint.write(w, {
        enabled: cp?.enabled ?? false,
        invert:  cp?.invert  ?? false,
        gainDb:  cp?.gainDb  ?? 0,
      });
    }
  }

  for (let o = 0; o < Wire.Const.NUM_OUTPUTS; o++) {
    const out = opts.outputs?.[o];
    Wire.OutputChannel.write(w, {
      enabled: out?.enabled ?? false,
      muted:   out?.muted   ?? false,
      gainDb:  out?.gainDb  ?? 0,
      delayMs: out?.delayMs ?? 0,
    });
  }

  Wire.PinConfig.write(w, {
    numPinOutputs: opts.numPinOutputs ?? 0,
    pins: Array.from({ length: Wire.Const.NUM_PIN_OUTPUTS }, (_, i) => opts.pins?.[i] ?? 0),
  });

  for (let ch = 0; ch < Wire.Const.NUM_CHANNELS; ch++) {
    for (let band = 0; band < Wire.Const.BANDS_MAX; band++) {
      const f = opts.filters?.[ch]?.[band] ?? { type: 0, frequency: 1000, q: 1, gain: 0 };
      Wire.BandParams.write(w, {
        type: f.type, frequency: f.frequency, q: f.q, gain: f.gain,
      });
    }
  }

  Wire.ChannelNames.write(
    w,
    Array.from({ length: Wire.Const.NUM_CHANNELS }, (_, ch) => opts.channelNames?.[ch] ?? ''),
  );

  // Optional V6 tail sections — written sequentially when the requested
  // packet size covers the section.  BulkSizes thresholds match the
  // parser's bulkLayout() gating so parse(synth(opts)) is a fixed point.
  if (wantSize >= Wire.BulkSizes.V3) {
    Wire.I2SConfig.write(w, {
      outputSlotTypes: opts.i2s
        ? Array.from(opts.i2s.outputSlotTypes).slice(0, Wire.Const.NUM_SPDIF_INSTANCES)
        : [0, 0, 0, 0],
      bckPin:               opts.i2s?.bckPin               ?? 0,
      mckPin:               opts.i2s?.mckPin               ?? 0,
      mckEnabled:           opts.i2s?.mckEnabled            ?? false,
      mckMultiplierEncoded: opts.i2s?.mckMultiplierEncoded  ?? 0,
    });
  }

  if (wantSize >= Wire.BulkSizes.V4) {
    Wire.LevellerConfig.write(w, {
      enabled:   opts.leveller?.enabled   ?? false,
      speed:     opts.leveller?.speed     ?? 0,
      lookahead: opts.leveller?.lookahead ?? false,
      amount:    opts.leveller?.amount    ?? 0,
      maxGainDb: opts.leveller?.maxGainDb ?? 0,
      gateDb:    opts.leveller?.gateDb    ?? -40,
    });
  }

  if (formatVersion >= 6 && wantSize >= Wire.BulkSizes.V6Preamp) {
    Wire.PreampConfig.write(w, {
      preampDb: [opts.preampLDb ?? 0, opts.preampRDb ?? 0],
    });
  }

  if (formatVersion >= 6 && wantSize >= Wire.BulkSizes.V6Full) {
    Wire.MasterVolume.write(w, { masterVolumeDb: opts.masterVolumeDb ?? 0 });
  }

  return w.toUint8Array();
}
