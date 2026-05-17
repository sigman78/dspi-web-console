// Parser side of the GetBufferStats packet (vendor request 0xB0).
// Fixed 44-byte packet.  Wire layout in `wireTypes.ts` (`WireBufferStats`).
// Spec: docs/HW-INTERFACE.md sec."bufferStats.ts".
//
// The synthesizer side is in `./bufferStats.syn.ts`.

import { Codec } from '../utils';
import * as Wire from './wireTypes';

export interface SpdifBufferStats {
  consumerFree: number;
  consumerPrepared: number;
  consumerPlaying: number;
  consumerFillPct: number;
  consumerMinFillPct: number;
  consumerMaxFillPct: number;
}

export interface PdmBufferStats {
  dmaFillPct: number;
  dmaMinFillPct: number;
  dmaMaxFillPct: number;
  ringFillPct: number;
  ringMinFillPct: number;
  ringMaxFillPct: number;
}

export interface BufferStats {
  numSpdif: number;
  flags: number;
  sequence: number;
  spdif: SpdifBufferStats[]; // length 4
  pdm: PdmBufferStats;
  pdmActive: boolean;
  streaming: boolean;
}

export function parseBufferStats(buffer: Uint8Array): BufferStats | null {
  if (buffer.length < Codec.sizeOf(Wire.BufferStats)) return null;
  const w = Codec.decode(Wire.BufferStats, buffer);
  // The struct codec already strips reserved (`_*`) fields from the output,
  // so `w.spdif` and `w.pdm` are clean; spread them through and add the
  // computed boolean projections.
  return {
    ...w,
    pdmActive: (w.flags & 0x01) !== 0,
    streaming: (w.flags & 0x02) !== 0,
  };
}
