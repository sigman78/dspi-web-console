// Synthesizer side of the GetBufferStats packet (encode); the parser is in
// `./bufferStats.ts`. Both share the `BufferStats` schema in `./wireTypes.ts`.

import { Codec } from '@/utils';
import type { PdmBufferStats, SpdifBufferStats } from './bufferStats';
import * as Wire from './wireTypes';

export interface SynthesizeBufferStatsOptions {
  numSpdif?: number;
  flags?: number;        // bit0=pdmActive, bit1=streaming (or set them via options below)
  pdmActive?: boolean;
  streaming?: boolean;
  sequence?: number;
  spdif?: Partial<SpdifBufferStats>[];
  pdm?: Partial<PdmBufferStats>;
}

export function synthesizeBufferStats(opts: SynthesizeBufferStatsOptions = {}): Uint8Array {
  const flags =
    opts.flags ??
    ((opts.pdmActive ? 0x01 : 0) | (opts.streaming ? 0x02 : 0));

  const spdif = Array.from(
    { length: Wire.Const.NUM_SPDIF_INSTANCES },
    (_, i) => fillSpdif(opts.spdif?.[i]),
  );

  return Codec.encode(Wire.BufferStats, {
    numSpdif: opts.numSpdif ?? 0,
    flags,
    sequence: opts.sequence ?? 0,
    spdif,
    pdm: fillPdm(opts.pdm),
  });
}

// helpers

const SPDIF_FIELDS: (keyof SpdifBufferStats)[] = [
  'consumerFree', 'consumerPrepared', 'consumerPlaying',
  'consumerFillPct', 'consumerMinFillPct', 'consumerMaxFillPct',
];

const PDM_FIELDS: (keyof PdmBufferStats)[] = [
  'dmaFillPct', 'dmaMinFillPct', 'dmaMaxFillPct',
  'ringFillPct', 'ringMinFillPct', 'ringMaxFillPct',
];

function fillSpdif(p?: Partial<SpdifBufferStats>): SpdifBufferStats {
  const out = {} as SpdifBufferStats;
  for (const k of SPDIF_FIELDS) out[k] = p?.[k] ?? 0;
  return out;
}

function fillPdm(p?: Partial<PdmBufferStats>): PdmBufferStats {
  const out = {} as PdmBufferStats;
  for (const k of PDM_FIELDS) out[k] = p?.[k] ?? 0;
  return out;
}
