import { describe, it, expect } from 'vitest';
import { parseBufferStats } from './bufferStats';
import { synthesizeBufferStats } from './bufferStats.syn';
import { Codec } from '../utils';
import * as Wire from './wireTypes';

describe('parseBufferStats', () => {
  const buf = synthesizeBufferStats({
    numSpdif: 4,
    pdmActive: true, streaming: true,
    sequence: 12345,
    spdif: [
      { consumerFree: 1, consumerPrepared: 2, consumerPlaying: 1,
        consumerFillPct: 60, consumerMinFillPct: 30, consumerMaxFillPct: 80 },
    ],
    pdm: {
      dmaFillPct: 50, dmaMinFillPct: 25, dmaMaxFillPct: 75,
      ringFillPct: 70, ringMinFillPct: 40, ringMaxFillPct: 90,
    },
  });

  it('produces a packet of the documented size', () => {
    expect(buf.byteLength).toBe(Codec.sizeOf(Wire.BufferStats));
  });

  it('parses header fields', () => {
    const p = parseBufferStats(buf);
    expect(p).not.toBeNull();
    expect(p!.numSpdif).toBe(4);
    expect(p!.pdmActive).toBe(true);
    expect(p!.streaming).toBe(true);
    expect(p!.sequence).toBe(12345);
  });

  it('parses SPDIF instance 0', () => {
    const p = parseBufferStats(buf)!;
    expect(p.spdif[0]).toEqual({
      consumerFree: 1, consumerPrepared: 2, consumerPlaying: 1,
      consumerFillPct: 60, consumerMinFillPct: 30, consumerMaxFillPct: 80,
    });
  });

  it('parses PDM block', () => {
    const p = parseBufferStats(buf)!;
    expect(p.pdm).toEqual({
      dmaFillPct: 50, dmaMinFillPct: 25, dmaMaxFillPct: 75,
      ringFillPct: 70, ringMinFillPct: 40, ringMaxFillPct: 90,
    });
  });

  it('returns null for short packets', () => {
    expect(parseBufferStats(new Uint8Array(10))).toBeNull();
  });

  it('roundtrips through synthesize ↔ parse for all SPDIF slots', () => {
    const out = synthesizeBufferStats({
      numSpdif: 2, streaming: true, sequence: 7,
      spdif: [
        { consumerFree: 5 },
        { consumerFree: 6 },
        { consumerFree: 7 },
        { consumerFree: 8 },
      ],
    });
    const p = parseBufferStats(out)!;
    expect(p.spdif.map((s) => s.consumerFree)).toEqual([5, 6, 7, 8]);
    expect(p.streaming).toBe(true);
    expect(p.pdmActive).toBe(false);
    expect(p.sequence).toBe(7);
  });
});
