// V17/V18 codec coverage: the ADAT config section (V17, appended last) and the
// leveller detector/apply channel masks (V18, an interior section grow). The
// load-bearing test is the interior-grow one: growing the leveller 16->20 must
// not misalign any section written after it.

import { describe, it, expect } from 'vitest';
import { buildBulkParams, defaultBulkParams, parseBulkParams } from './bulkParser';
import * as Wire from './wireTypes';

function v17Base() {
  return defaultBulkParams({ platformId: 1, numCh: 17, numOut: 9, numIn: 8, formatVersion: 17 });
}
function v18Base() {
  return defaultBulkParams({ platformId: 1, numCh: 17, numOut: 9, numIn: 8, formatVersion: 18 });
}

describe('bulkParser — V17/V18 packet sizes', () => {
  it('BULK_SIZE_V17/V18 match the firmware sizeof(WireBulkParams) contract', () => {
    // From bulk_params.h: V16 5864 + 8-byte ADAT = 5872 (V17); + leveller
    // 16->20 grow = 5876 (V18). A codec shape drift breaks this first.
    expect(Wire.BULK_SIZE_V17).toBe(5872);
    expect(Wire.BULK_SIZE_V18).toBe(5876);
  });

  it('bulkSizeForVersion maps 17->5872 and 18->5876', () => {
    expect(Wire.bulkSizeForVersion(17)).toBe(5872);
    expect(Wire.bulkSizeForVersion(18)).toBe(5876);
  });
});

describe('bulkParser — V17 (ADAT) packet', () => {
  it('roundtrips the ADAT section; leveller masks default all-on (no V18 mask bytes)', () => {
    const bulk = v17Base();
    bulk.adat = { enabled: true, pin: 22 };
    // A section that lives after the leveller, to catch any misalignment.
    bulk.dacHwMute = { enabled: true, activeLow: true, pin: 11, holdMs: 20, releaseMs: 50 };

    const bytes = buildBulkParams(bulk);
    expect(bytes.byteLength).toBe(Wire.BULK_SIZE_V17);

    const p = parseBulkParams(bytes);
    expect(p.formatVersion).toBe(17);
    expect(p.adat).toEqual({ enabled: true, pin: 22 });
    // V17 carries no leveller-mask bytes; the parser defaults them all-on.
    expect(p.leveller.detectorMask).toBe(0xFF);
    expect(p.leveller.applyMask).toBe(0xFF);
    expect(p.dacHwMute).toEqual({ enabled: true, activeLow: true, pin: 11, holdMs: 20, releaseMs: 50 });
  });
});

describe('bulkParser — V18 (leveller masks) packet', () => {
  it('roundtrips leveller channel masks AND the ADAT section', () => {
    const bulk = v18Base();
    bulk.leveller = { ...bulk.leveller, enabled: true, amount: 60, detectorMask: 0x05, applyMask: 0x0C };
    bulk.adat = { enabled: true, pin: 12 };

    const bytes = buildBulkParams(bulk);
    expect(bytes.byteLength).toBe(Wire.BULK_SIZE_V18);

    const p = parseBulkParams(bytes);
    expect(p.formatVersion).toBe(18);
    expect(p.leveller.detectorMask).toBe(0x05);
    expect(p.leveller.applyMask).toBe(0x0C);
    expect(p.leveller.enabled).toBe(true);
    expect(p.leveller.amount).toBeCloseTo(60, 4);
    expect(p.adat).toEqual({ enabled: true, pin: 12 });
  });

  it('the leveller +4 interior grow does not corrupt any section written after it', () => {
    // Every section that lives AFTER the 20-byte leveller gets a distinctive
    // value. If the interior grow shifted them incorrectly, these reads misalign
    // and the assertions fail -- the whole point of the V18 layout change.
    const bulk = v18Base();
    bulk.leveller = { ...bulk.leveller, detectorMask: 0xAA, applyMask: 0x55 };
    bulk.inputPreampsDb = [0, -1, -2, -3, -4, -5, -6, -7];   // preamp (right after leveller)
    bulk.masterVolumeDb = -12;                                // master volume
    bulk.inputConfig = {
      source: 2, spdifRxPin: 5, i2sRxPins: [1, 2, 3, 4], i2sInputRateEnc: 2, i2sInputChannels: 6,
      spdifRxPinExt: [0, 0], spdifRxEnabledExtP1: 0, i2sClockMode: 0,
      adatInputPin: 0, adatInputEnabledP1: 0, adatInputClockModeP1: 0,
    };
    bulk.dacHwMute = { enabled: true, activeLow: true, pin: 11, holdMs: 20, releaseMs: 50 };
    bulk.crossover[8][0] = { type: 34, bypass: false, frequency: 2400, q: 0.707, gain: 0, qpRaw: 0 };
    bulk.crossover[16][3] = { type: 33, bypass: true, frequency: 120, q: 0.5, gain: 0, qpRaw: 0 };
    bulk.adat = { enabled: true, pin: 30 };

    const p = parseBulkParams(buildBulkParams(bulk));
    expect(p.leveller.detectorMask).toBe(0xAA);
    expect(p.leveller.applyMask).toBe(0x55);
    expect(p.inputPreampsDb.map(Math.round)).toEqual([0, -1, -2, -3, -4, -5, -6, -7]);
    expect(p.masterVolumeDb).toBeCloseTo(-12, 4);
    expect(p.inputConfig).toEqual({
      source: 2, spdifRxPin: 5, i2sRxPins: [1, 2, 3, 4], i2sInputRateEnc: 2, i2sInputChannels: 6,
      spdifRxPinExt: [0, 0], spdifRxEnabledExtP1: 0, i2sClockMode: 0,
      adatInputPin: 0, adatInputEnabledP1: 0, adatInputClockModeP1: 0,
    });
    expect(p.dacHwMute).toEqual({ enabled: true, activeLow: true, pin: 11, holdMs: 20, releaseMs: 50 });
    expect(p.crossover[8][0].type).toBe(34);
    expect(p.crossover[8][0].frequency).toBeCloseTo(2400, 3);
    expect(p.crossover[16][3].bypass).toBe(true);
    expect(p.adat).toEqual({ enabled: true, pin: 30 });
  });

  it('down-converts a V18 snapshot to a V16 packet (masks + ADAT dropped, 5864 bytes)', () => {
    const bulk = v18Base();
    bulk.leveller = { ...bulk.leveller, detectorMask: 0x05, applyMask: 0x0C };
    bulk.adat = { enabled: true, pin: 12 };
    bulk.masterVolumeDb = -9;

    const bytes = buildBulkParams(bulk, 16);
    expect(bytes.byteLength).toBe(Wire.BULK_SIZE_V16);

    const p = parseBulkParams(bytes);
    expect(p.formatVersion).toBe(16);
    expect(p.masterVolumeDb).toBeCloseTo(-9, 4);
    // V16 has neither mask bytes nor an ADAT section; the parser defaults them.
    expect(p.leveller.detectorMask).toBe(0xFF);
    expect(p.leveller.applyMask).toBe(0xFF);
    expect(p.adat).toEqual({ enabled: false, pin: 0 });
  });

  it('default V18 bulk roundtrips through build+parse cleanly', () => {
    const base = v18Base();
    expect(parseBulkParams(buildBulkParams(base))).toEqual(base);
  });
});
