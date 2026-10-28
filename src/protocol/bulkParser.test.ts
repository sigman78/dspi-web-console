// Standalone tests for the bulk parser.  Covers parse/build
// roundtrip across header and sections.

import { describe, it, expect } from 'vitest';

import { parseBulkParams, buildBulkParams, defaultBulkParams, type BulkParams, type WireFilter } from './bulkParser';
import { makeBulk, makeBulkObject } from '@test/fixtures/bulkFixtures';
import * as Wire from './wireTypes';
import { FilterType } from '@/domain';

const { NUM_CHANNELS, NUM_OUTPUTS, BANDS_MAX } = Wire.Const;

// Header / global / crossfeed

describe('bulkParser — header + global', () => {
  it('parses header fields', () => {
    const buf = makeBulk({
      numCh: 17, numOut: 9, numIn: 8, maxBands: 12,
    });
    const p = parseBulkParams(buf);
    expect(p.formatVersion).toBe(Wire.MIN_WIRE_VERSION);
    expect(p.platformId).toBe(1);
    expect(p.numCh).toBe(17);
    expect(p.numOut).toBe(9);
    expect(p.numIn).toBe(8);
    expect(p.maxBands).toBe(12);
  });

  it('parses global flags + preamp', () => {
    const buf = makeBulk({
      bypass: true, preampDb: -3.5,
      loudness: { enabled: true, refSpl: 75, intensityPct: 0.5, outputMask: 0xFFFF },
    });
    const p = parseBulkParams(buf);
    expect(p.bypass).toBe(true);
    expect(p.preampDb).toBeCloseTo(-3.5, 5);
    expect(p.loudness).toEqual({ enabled: true, refSpl: 75, intensityPct: 0.5, outputMask: 0xFFFF });
  });

  it('parses crossfeed', () => {
    const buf = makeBulk({
      crossfeed: { enabled: true, preset: 2, itd: true, freq: 700, feedDb: -8, outputPairMask: 0x01 },
    });
    const p = parseBulkParams(buf);
    expect(p.crossfeed).toEqual({
      enabled: true, preset: 2, itd: true, freq: 700, feedDb: -8, outputPairMask: 0x01,
    });
  });
});

// Per-channel + matrix

describe('bulkParser — per-channel + matrix', () => {
  it('parses 17 delays', () => {
    const delaysMs = Array.from({ length: NUM_CHANNELS }, (_, i) => i * 0.25);
    const p = parseBulkParams(makeBulk({ delaysMs }));
    delaysMs.forEach((v, i) => expect(p.delaysMs[i]).toBeCloseTo(v, 5));
  });

  it('parses 8x9 crosspoints', () => {
    const cps = Array.from({ length: Wire.Const.NUM_INPUTS }, (_, inp) =>
      Array.from({ length: NUM_OUTPUTS }, (_, outp) => ({
        enabled: (inp + outp) % 2 === 0,
        invert: outp === 3,
        gainDb: -1 * outp + 0.25 * inp,
      })),
    );
    const p = parseBulkParams(makeBulk({ crosspoints: cps }));
    for (let inp = 0; inp < Wire.Const.NUM_INPUTS; inp++) {
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
    const p = parseBulkParams(makeBulk({ outputs: outs }));
    for (let o = 0; o < NUM_OUTPUTS; o++) {
      expect(p.outputs[o].enabled).toBe(outs[o].enabled);
      expect(p.outputs[o].muted).toBe(outs[o].muted);
      expect(p.outputs[o].gainDb).toBeCloseTo(outs[o].gainDb, 4);
      expect(p.outputs[o].delayMs).toBeCloseTo(outs[o].delayMs, 4);
    }
  });

  it('parses non-trivial filter at ch=3 band=5', () => {
    const filters: WireFilter[][] = Array.from({ length: NUM_CHANNELS }, () =>
      Array.from({ length: BANDS_MAX }, () => ({
        type: FilterType.Flat, bypass: false, frequency: 1000, q: 1, gain: 0, qpRaw: 0,
      } as WireFilter)),
    );
    filters[3][5] = { type: FilterType.Peaking, bypass: false, frequency: 2500, q: 0.7, gain: 4.5, qpRaw: 0 };
    const f = parseBulkParams(makeBulk({ filters })).filters[3][5];
    expect(f.type).toBe(FilterType.Peaking);
    expect(f.frequency).toBeCloseTo(2500, 4);
    expect(f.q).toBeCloseTo(0.7, 4);
    expect(f.gain).toBeCloseTo(4.5, 4);
  });

  it('parses NUL-terminated UTF-8 channel names', () => {
    const names = Array.from({ length: NUM_CHANNELS }, (_, i) => (i % 3 === 2 ? '' : `Ch ${i} \u00e9`));
    const p = parseBulkParams(makeBulk({ channelNames: names }));
    expect(p.channelNames).toEqual(names);
  });
});

// Trailing sections

describe('bulkParser — trailing sections', () => {
  it('parses per-input preamp + master volume', () => {
    const p = parseBulkParams(makeBulk({
      inputPreampsDb: [-1, -2, 0, 0, 0, 0, 0, -7],
      masterVolumeDb: -12.5,
    }));
    expect(p.inputPreampsDb[0]).toBeCloseTo(-1, 5);
    expect(p.inputPreampsDb[1]).toBeCloseTo(-2, 5);
    expect(p.inputPreampsDb[7]).toBeCloseTo(-7, 5);
    expect(p.masterVolumeDb).toBeCloseTo(-12.5, 5);
  });

  it('parses I2S + leveller blocks', () => {
    const p = parseBulkParams(makeBulk({
      i2s: {
        outputSlotTypes: [0, 1, 0, 1],
        bckPin: 26, mckPin: 27, mckEnabled: true, mckMultiplierEncoded: 1,
        clockPinModeP1: 0, bckPinSlave: 0,
      },
      leveller: {
        enabled: true, speed: 1, lookahead: true,
        amount: 60, maxGainDb: 12, gateDb: -50,
        detectorMask: 0xFF, applyMask: 0xFF,
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
});

describe('buildBulkParams + defaultBulkParams', () => {
  it('default bulk roundtrips through build+parse cleanly', () => {
    const base = defaultBulkParams({ platformId: 1, numCh: 17, numOut: 9 });
    const bytes = buildBulkParams(base);
    expect(bytes.byteLength).toBe(Wire.BULK_SIZE_V28);
    expect(parseBulkParams(bytes)).toEqual(base);
  });

  it('non-default fields survive roundtrip', () => {
    const base = defaultBulkParams({ platformId: 1, numCh: 17, numOut: 9 });
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

  it('builder throws below the wire floor, for the snapshot or an explicit version', () => {
    const base = defaultBulkParams({ platformId: 1, numCh: 17, numOut: 9 });
    expect(() => buildBulkParams({ ...base, formatVersion: 27 })).toThrow(/floor/);
    expect(() => buildBulkParams(base, 10)).toThrow(/floor/);
  });

  it('echoes the device platformId and channel counts into the written header', () => {
    // Firmware rejects a SetAllParams whose platform_id or channel counts
    // don't match the device, so the writer must echo what it parsed.
    const bulk: BulkParams = {
      ...defaultBulkParams({ platformId: 0, numCh: 7, numOut: 5 }),
      numCh: 7, numOut: 5,
    };
    const header = parseBulkParams(buildBulkParams(bulk));
    expect(header.platformId).toBe(0);
    expect(header.numCh).toBe(7);
    expect(header.numOut).toBe(5);
  });

  it('surfaces payloadLength from the header', () => {
    expect(parseBulkParams(makeBulk()).payloadLength).toBe(Wire.BULK_SIZE_V28);
  });
});

describe('bulkParser — V28 floor sections', () => {
  it('decodes tail sections', () => {
    const obj = makeBulkObject({
      inputConfig: {
        source: 1, spdifRxPin: 5, i2sRxPins: [0, 0, 0, 0], i2sInputRateEnc: 1, i2sInputChannels: 0,
        spdifRxPinExt: [0, 0, 0], spdifRxEnabledExtP1: 0, i2sClockMode: 0,
        adatInputPin: 0, adatInputEnabledP1: 0, adatInputClockModeP1: 0,
      },
      lgSoundSync: { enabled: true, present: true, volume: 40, muted: false },
      userVolume:  { volumeDb: -6.5, mute: true },
      dacHwMute:   { enabled: true, activeLow: true, pin: 11, holdMs: 20, releaseMs: 50 },
    });
    const p = parseBulkParams(buildBulkParams(obj));
    expect(p.inputConfig).toEqual(obj.inputConfig);
    expect(p.lgSoundSync).toEqual({ enabled: true, present: true, volume: 40, muted: false });
    expect(p.userVolume.volumeDb).toBeCloseTo(-6.5, 4);
    expect(p.userVolume.mute).toBe(true);
    expect(p.dacHwMute).toEqual({ enabled: true, activeLow: true, pin: 11, holdMs: 20, releaseMs: 50 });
  });

  it('round-trips the output masks, crossover bands and ADAT/psybass/upmix sections', () => {
    const base = makeBulkObject();
    const obj: BulkParams = {
      ...base,
      loudness: { ...base.loudness, outputMask: 0x0155 },
      crossfeed: { ...base.crossfeed, outputPairMask: 0x06 },
      leveller: { ...base.leveller, detectorMask: 0x0F, applyMask: 0xF0 },
      adat: { enabled: true, pin: 14 },
      psybass: { ...base.psybass, enabled: true, cutoffHz: 95, outputMask: 0x00F0 },
      upmix: { ...base.upmix, enabled: true, centerMode: 2, presenceDb: -3 },
    };
    obj.crossover = obj.crossover.map((bands) => bands.map((f) => ({ ...f })));
    obj.crossover[9][2] = { type: FilterType.Peaking, bypass: false, frequency: 3000, q: 2, gain: 3, qpRaw: 0 };

    const p = parseBulkParams(buildBulkParams(obj));
    expect(p.loudness.outputMask).toBe(0x0155);
    expect(p.crossfeed.outputPairMask).toBe(0x06);
    expect(p.leveller.detectorMask).toBe(0x0F);
    expect(p.leveller.applyMask).toBe(0xF0);
    expect(p.adat).toEqual({ enabled: true, pin: 14 });
    expect(p.psybass).toEqual(obj.psybass);
    expect(p.upmix).toEqual(obj.upmix);
    expect(p.crossover[9][2].frequency).toBeCloseTo(3000, 3);
    expect(p.crossover[9][2].gain).toBeCloseTo(3, 4);
  });

  it('decodes per-band bypass', () => {
    const filters: WireFilter[][] = Array.from({ length: NUM_CHANNELS }, () =>
      Array.from({ length: BANDS_MAX }, () => ({
        type: FilterType.Flat, bypass: false, frequency: 1000, q: 1, gain: 0, qpRaw: 0,
      })),
    );
    filters[2][4] = { type: FilterType.Peaking, bypass: true, frequency: 800, q: 1, gain: 2, qpRaw: 0 };
    const p = parseBulkParams(buildBulkParams(makeBulkObject({ filters })));
    expect(p.filters[2][4].bypass).toBe(true);
    expect(p.filters[0][0].bypass).toBe(false);
  });

  it('keeps the Linkwitz qp sidecar only on Linkwitz Transform bands', () => {
    const base = makeBulkObject();
    const filters = base.filters.map((bands) => bands.map((f) => ({ ...f })));
    filters[1][0] = { type: FilterType.LinkwitzTransform, bypass: false, frequency: 30, q: 0.5, gain: 0, qpRaw: 400 };
    filters[1][1] = { type: FilterType.Peaking, bypass: false, frequency: 800, q: 1, gain: 2, qpRaw: 400 };
    const p = parseBulkParams(buildBulkParams({ ...base, filters }));
    expect(p.filters[1][0].qpRaw).toBe(400);
    expect(p.filters[1][1].qpRaw).toBe(0);
  });
});
