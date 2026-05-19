// Standalone tests for the bulk parser.  Covers parse/synthesize
// roundtrip across header, sections, and the V6 optional tail, plus
// a fuzz sweep over randomly-shaped options.

import { describe, it, expect } from 'vitest';

import { parseBulkParams, buildBulkParams, defaultBulkParams, type BulkParams } from './bulkParser';
import { synthesizeBulkParams, type SynthesizeOptions } from './bulkParser.syn';
import * as Wire from './wireTypes';
import { FilterType, type FilterParams, CrossfeedPreset, LevellerSpeed } from '@/domain';

const { NUM_CHANNELS, NUM_OUTPUTS, BANDS_MAX } = Wire.Const;
const { BulkLimits } = Wire;

// Header / global / crossfeed

describe('bulkParser — header + global', () => {
  it('parses header fields', () => {
    const buf = synthesizeBulkParams({
      formatVersion: 6, platformId: 1, numCh: 11, numOut: 9, numIn: 2, maxBands: 12,
    });
    const p = parseBulkParams(buf);
    expect(p.formatVersion).toBe(6);
    expect(p.platformId).toBe(1);
    expect(p.numCh).toBe(11);
    expect(p.numOut).toBe(9);
    expect(p.numIn).toBe(2);
    expect(p.maxBands).toBe(12);
  });

  it('parses global flags + preamp', () => {
    const buf = synthesizeBulkParams({
      formatVersion: 6, bypass: true, preampDb: -3.5,
      loudness: { enabled: true, refSpl: 75, intensityPct: 0.5 },
    });
    const p = parseBulkParams(buf);
    expect(p.bypass).toBe(true);
    expect(p.preampDb).toBeCloseTo(-3.5, 5);
    expect(p.loudness).toEqual({ enabled: true, refSpl: 75, intensityPct: 0.5 });
  });

  it('parses crossfeed', () => {
    const buf = synthesizeBulkParams({
      crossfeed: { enabled: true, preset: 2, itd: true, freq: 700, feedDb: -8 },
    });
    const p = parseBulkParams(buf);
    expect(p.crossfeed).toEqual({
      enabled: true, preset: 2, itd: true, freq: 700, feedDb: -8,
    });
  });
});

// Per-channel + matrix

describe('bulkParser — per-channel + matrix', () => {
  it('parses 11 delays', () => {
    const delaysMs = Array.from({ length: NUM_CHANNELS }, (_, i) => i * 0.25);
    const p = parseBulkParams(synthesizeBulkParams({ delaysMs }));
    delaysMs.forEach((v, i) => expect(p.delaysMs[i]).toBeCloseTo(v, 5));
  });

  it('parses 2x9 crosspoints', () => {
    const cps = Array.from({ length: 2 }, (_, inp) =>
      Array.from({ length: NUM_OUTPUTS }, (_, outp) => ({
        enabled: (inp + outp) % 2 === 0,
        invert: outp === 3,
        gainDb: -1 * outp + 0.25 * inp,
      })),
    );
    const p = parseBulkParams(synthesizeBulkParams({ crosspoints: cps }));
    for (let inp = 0; inp < 2; inp++) {
      for (let outp = 0; outp < NUM_OUTPUTS; outp++) {
        expect(p.crosspoints[inp][outp].enabled).toBe(cps[inp][outp].enabled);
        expect(p.crosspoints[inp][outp].invert).toBe(cps[inp][outp].invert);
        expect(p.crosspoints[inp][outp].gainDb).toBeCloseTo(cps[inp][outp].gainDb, 4);
      }
    }
  });

  it('parses 9 outputs', () => {
    const outs = Array.from({ length: NUM_OUTPUTS }, (_, o) => ({
      enabled: o !== 7, muted: o === 2, gainDb: -0.5 * o, delayMs: 0.1 * o,
    }));
    const p = parseBulkParams(synthesizeBulkParams({ outputs: outs }));
    for (let o = 0; o < NUM_OUTPUTS; o++) {
      expect(p.outputs[o].enabled).toBe(outs[o].enabled);
      expect(p.outputs[o].muted).toBe(outs[o].muted);
      expect(p.outputs[o].gainDb).toBeCloseTo(outs[o].gainDb, 4);
      expect(p.outputs[o].delayMs).toBeCloseTo(outs[o].delayMs, 4);
    }
  });

  it('parses non-trivial filter at ch=3 band=5', () => {
    const filters: FilterParams[][] = Array.from({ length: NUM_CHANNELS }, () =>
      Array.from({ length: BANDS_MAX }, () => ({
        type: FilterType.Flat, frequency: 1000, q: 1, gain: 0,
      } as FilterParams)),
    );
    filters[3][5] = { type: FilterType.Peaking, frequency: 2500, q: 0.7, gain: 4.5 };
    const f = parseBulkParams(synthesizeBulkParams({ filters })).filters[3][5];
    expect(f.type).toBe(FilterType.Peaking);
    expect(f.frequency).toBeCloseTo(2500, 4);
    expect(f.q).toBeCloseTo(0.7, 4);
    expect(f.gain).toBeCloseTo(4.5, 4);
  });

  it('parses NUL-terminated UTF-8 channel names', () => {
    const names = ['Input 1 L', 'Input 1 R', '', 'OUT3', '', '', '', '', '', '', 'PDM'];
    const p = parseBulkParams(synthesizeBulkParams({ channelNames: names }));
    expect(p.channelNames).toEqual(names);
  });
});

// V6 trailing sections

describe('bulkParser — V6 trailing sections', () => {
  it('parses per-channel preamp + master volume on V6', () => {
    const p = parseBulkParams(synthesizeBulkParams({
      formatVersion: 6,
      preampLDb: -1, preampRDb: -2,
      masterVolumeDb: -12.5,
    }));
    expect(p.preampLDb).toBeCloseTo(-1, 5);
    expect(p.preampRDb).toBeCloseTo(-2, 5);
    expect(p.masterVolumeDb).toBeCloseTo(-12.5, 5);
  });

  it('treats a V2-only packet as legacy (no V6 fields — defaults to 0)', () => {
    const p = parseBulkParams(synthesizeBulkParams({
      formatVersion: 2,
      packetSize: BulkLimits.MinPacketSize,
      preampLDb: 9, preampRDb: 9, masterVolumeDb: -50,
    }));
    expect(p.formatVersion).toBe(2);
    // V6 fields are non-nullable; absent sections fall back to factory defaults (0).
    expect(p.preampLDb).toBe(0);
    expect(p.preampRDb).toBe(0);
    expect(p.masterVolumeDb).toBe(0);
  });

  it('parses optional I2S + leveller blocks when present', () => {
    const p = parseBulkParams(synthesizeBulkParams({
      i2s: {
        outputSlotTypes: [0, 1, 0, 1],
        bckPin: 26, mckPin: 27, mckEnabled: true, mckMultiplierEncoded: 1,
      },
      leveller: {
        enabled: true, speed: 1, lookahead: true,
        amount: 60, maxGainDb: 12, gateDb: -50,
      },
    }));
    expect(p.i2s.outputSlotTypes).toEqual([0, 1, 0, 1]);
    expect(p.i2s.mckEnabled).toBe(true);
    expect(p.leveller.amount).toBeCloseTo(60, 4);
    expect(p.leveller.gateDb).toBeCloseTo(-50, 4);
  });
});

// Short / partial buffers

describe('bulkParser — short buffers', () => {
  it('rejects below minimum size', () => {
    expect(() => parseBulkParams(new Uint8Array(100))).toThrow();
  });

  // Buffers sized inside the V6 tail must parse correctly.  V6 fields are
  // non-nullable — absent sections fall back to factory defaults (0), not null.
  it('parses partial V6 tail consistently across the preamp/master gap', () => {
    for (const sz of [2864, 2868, 2872, 2876, 2880, 2884, 2888, 2892, 2896]) {
      const buf = synthesizeBulkParams({
        formatVersion: 6,
        packetSize: sz,
        preampLDb: -1.5, preampRDb: -2.5, masterVolumeDb: -7.25,
      });
      const p = parseBulkParams(buf);

      // preamp section starts at 2864; it requires 16 bytes (8 data + 8 reserved).
      const hasPreamp = sz >= 2880;
      // master vol at 2880; requires 16 bytes (4 data + 12 reserved).
      const hasMaster = sz >= 2896;

      if (hasPreamp) {
        expect(p.preampLDb).toBeCloseTo(-1.5, 5);
        expect(p.preampRDb).toBeCloseTo(-2.5, 5);
      } else {
        // Section absent — parser returns factory default (0).
        expect(p.preampLDb).toBe(0);
        expect(p.preampRDb).toBe(0);
      }
      if (hasMaster) {
        expect(p.masterVolumeDb).toBeCloseTo(-7.25, 5);
      } else {
        // Section absent — parser returns factory default (0).
        expect(p.masterVolumeDb).toBe(0);
      }
    }
  });
});

// Fuzz: round-trip 30 random shapes through synth and parse

function rng(seed: number): () => number {
  // mulberry32
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomOpts(r: () => number): SynthesizeOptions {
  const v = r() < 0.85 ? 6 : 2;
  const bytes = (v >= 6) ? 2896 : BulkLimits.MinPacketSize;
  return {
    formatVersion: v,
    platformId: r() < 0.5 ? 0 : 1,
    bypass: r() < 0.5,
    preampDb: (r() - 0.5) * 24,
    loudness: { enabled: r() < 0.5, refSpl: 60 + r() * 30, intensityPct: r() },
    crossfeed: {
      enabled: r() < 0.5, preset: Math.floor(r() * 4) as CrossfeedPreset,
      itd: r() < 0.5, freq: 300 + r() * 600, feedDb: -10 + r() * 5,
    },
    delaysMs: Array.from({ length: NUM_CHANNELS }, () => r() * 5),
    crosspoints: Array.from({ length: 2 }, () =>
      Array.from({ length: NUM_OUTPUTS }, () => ({
        enabled: r() < 0.5, invert: r() < 0.3, gainDb: (r() - 0.5) * 12,
      }))),
    outputs: Array.from({ length: NUM_OUTPUTS }, () => ({
      enabled: r() < 0.7, muted: r() < 0.2,
      gainDb: (r() - 0.5) * 6, delayMs: r() * 2,
    })),
    pins: [Math.floor(r()*30), Math.floor(r()*30), Math.floor(r()*30), Math.floor(r()*30), Math.floor(r()*30)],
    numPinOutputs: Math.floor(r() * 6),
    filters: Array.from({ length: NUM_CHANNELS }, () =>
      Array.from({ length: BANDS_MAX }, () => ({
        type: Math.floor(r() * 6) as FilterType,
        frequency: 50 + r() * 19000,
        q: 0.1 + r() * 8,
        gain: (r() - 0.5) * 24,
      } as FilterParams))),
    channelNames: Array.from({ length: NUM_CHANNELS }, (_, i) => `ch_${i}_${Math.floor(r()*1000)}`),
    i2s: bytes >= 2848 ? {
      outputSlotTypes: [0, 1, 0, 1],
      bckPin: 8, mckPin: 9,
      mckEnabled: r() < 0.5,
      mckMultiplierEncoded: r() < 0.5 ? 0 : 1,
    } : undefined,
    leveller: bytes >= 2864 ? {
      enabled: r() < 0.5,
      speed: Math.floor(r() * 3) as LevellerSpeed,
      lookahead: r() < 0.5,
      amount: r() * 100, maxGainDb: r() * 30, gateDb: -r() * 90,
    } : undefined,
    preampLDb:      v >= 6 ? (r() - 0.5) * 12 : undefined,
    preampRDb:      v >= 6 ? (r() - 0.5) * 12 : undefined,
    masterVolumeDb: v >= 6 ? -r() * 60       : undefined,
    packetSize: bytes,
  };
}

describe('buildBulkParams + defaultBulkParams', () => {
  it('default bulk roundtrips through build+parse cleanly', () => {
    const base = defaultBulkParams({ platformId: 1, numCh: 11, numOut: 9 });
    const bytes = buildBulkParams(base);
    expect(bytes.byteLength).toBe(Wire.BulkLimits.MaxRequestSize);  // 2896
    const parsed = parseBulkParams(bytes);
    expect(parsed).toEqual(base);
  });

  it('non-default fields survive roundtrip', () => {
    const base = defaultBulkParams({ platformId: 1, numCh: 11, numOut: 9 });
    const bulk: BulkParams = {
      ...base,
      bypass: true,
      preampDb: -3.5,
      masterVolumeDb: -12,
      channelNames: base.channelNames.map((_, i) => `ch${i}`),
    };
    const parsed = parseBulkParams(buildBulkParams(bulk));
    expect(parsed.bypass).toBe(true);
    expect(parsed.preampDb).toBeCloseTo(-3.5);
    expect(parsed.masterVolumeDb).toBeCloseTo(-12);
    expect(parsed.channelNames).toEqual(bulk.channelNames);
  });

  it('builder throws on non-V6 input', () => {
    const base = defaultBulkParams({ platformId: 1, numCh: 11, numOut: 9 });
    expect(() => buildBulkParams({ ...base, formatVersion: 5 }))
      .toThrow(/V6|formatVersion/);
  });
});

describe('bulkParser — fuzz round-trip', () => {
  const r = rng(0xC0FFEE);
  for (let i = 0; i < 30; i++) {
    const opts = randomOpts(r);
    it(`case #${i} (V${opts.formatVersion}, ${opts.packetSize}B)`, () => {
      const a = synthesizeBulkParams(opts);
      const p = parseBulkParams(a);
      // Re-synthesize from the parsed result and compare bytes; proves
      // that parse -> synth is a fixed point (no information lost).
      const reopts: SynthesizeOptions = {
        formatVersion:  p.formatVersion,
        platformId:     p.platformId,
        numCh:          p.numCh, numOut: p.numOut, numIn: p.numIn,
        maxBands:       p.maxBands,
        bypass:         p.bypass,
        preampDb:       p.preampDb,
        loudness:       p.loudness,
        crossfeed:      p.crossfeed,
        delaysMs:       p.delaysMs,
        crosspoints:    p.crosspoints,
        outputs:        p.outputs,
        numPinOutputs:  p.numPinOutputs,
        pins:           p.pins,
        filters:        p.filters,
        channelNames:   p.channelNames,
        i2s:            p.i2s,
        leveller:       p.leveller,
        preampLDb:      p.preampLDb,
        preampRDb:      p.preampRDb,
        masterVolumeDb: p.masterVolumeDb,
        packetSize:     opts.packetSize,
      };
      const b = synthesizeBulkParams(reopts);
      expect(b).toEqual(a);
    });
  }
});
