// V22/V23/V24 codec coverage: the Linkwitz Transform qp sidecar (V22, PEQ/
// crossover band reserved bytes), psychoacoustic bass (V23, appended section,
// packet grows to 5900 B), and the ADAT input config sentinel bytes (V24,
// InputConfig reserved-byte claim, no further size change).

import { describe, it, expect } from 'vitest';
import { buildBulkParams, defaultBulkParams, parseBulkParams } from './bulkParser';
import * as Wire from './wireTypes';

const LT = 11; // FilterType.LinkwitzTransform, duplicated to keep this file domain-free.

function v21Base() {
  return defaultBulkParams({ platformId: 1, numCh: 17, numOut: 9, numIn: 8, formatVersion: 21 });
}
function v22Base() {
  return defaultBulkParams({ platformId: 1, numCh: 17, numOut: 9, numIn: 8, formatVersion: 22 });
}
function v23Base() {
  return defaultBulkParams({ platformId: 1, numCh: 17, numOut: 9, numIn: 8, formatVersion: 23 });
}
function v24Base() {
  return defaultBulkParams({ platformId: 1, numCh: 17, numOut: 9, numIn: 8, formatVersion: 24 });
}

describe('bulkParser — V22/V23/V24 packet sizes', () => {
  it('BULK_SIZE_V22 equals BULK_SIZE_V21 (no packet-size change)', () => {
    expect(Wire.BULK_SIZE_V22).toBe(Wire.BULK_SIZE_V21);
  });

  it('BULK_SIZE_V23 grows by the 24-byte psybass section', () => {
    expect(Wire.BULK_SIZE_V23).toBe(Wire.BULK_SIZE_V22 + 24);
    expect(Wire.BULK_SIZE_V23).toBe(5900);
  });

  it('BULK_SIZE_V24 equals BULK_SIZE_V23 (no packet-size change)', () => {
    expect(Wire.BULK_SIZE_V24).toBe(Wire.BULK_SIZE_V23);
  });

  it('bulkSizeForVersion maps 22->5876, 23->5900, 24->5900', () => {
    expect(Wire.bulkSizeForVersion(22)).toBe(5876);
    expect(Wire.bulkSizeForVersion(23)).toBe(5900);
    expect(Wire.bulkSizeForVersion(24)).toBe(5900);
  });
});

describe('bulkParser — V22 (Linkwitz Transform qp) packet', () => {
  it('roundtrips qp for an LT band', () => {
    const bulk = v22Base();
    bulk.filters[2][3] = { type: LT, bypass: false, frequency: 45, q: 0.6, gain: 90, qpRaw: 512 };

    const bytes = buildBulkParams(bulk);
    expect(bytes.byteLength).toBe(Wire.BULK_SIZE_V22);

    const p = parseBulkParams(bytes);
    expect(p.filters[2][3].type).toBe(LT);
    expect(p.filters[2][3].qpRaw).toBe(512);
  });

  it('forces qp to 0 on build for a non-LT band, even if qpRaw was staged nonzero', () => {
    const bulk = v22Base();
    bulk.filters[0][0] = { type: 1 /* Peaking */, bypass: false, frequency: 1000, q: 1, gain: 3, qpRaw: 999 };

    const p = parseBulkParams(buildBulkParams(bulk));
    expect(p.filters[0][0].qpRaw).toBe(0);
  });

  it('forces qp to 0 for crossover bands too (same BandParamsQp shape, never LT)', () => {
    const bulk = v22Base();
    bulk.crossover[8][0] = { type: 34, bypass: false, frequency: 2400, q: 0.707, gain: 0, qpRaw: 123 };

    const p = parseBulkParams(buildBulkParams(bulk));
    expect(p.crossover[8][0].qpRaw).toBe(0);
  });

  it('a pre-V22 packet defaults qpRaw to 0 (no qp bytes on the wire)', () => {
    const bulk = v21Base();
    bulk.filters[2][3] = { type: LT, bypass: false, frequency: 45, q: 0.6, gain: 90, qpRaw: 512 };

    // Writing at V21 has no qp sidecar to carry the value in.
    const p = parseBulkParams(buildBulkParams(bulk, 21));
    expect(p.filters[2][3].qpRaw).toBe(0);
  });

  it('default V22 bulk roundtrips through build+parse cleanly', () => {
    const base = v22Base();
    expect(parseBulkParams(buildBulkParams(base))).toEqual(base);
  });
});

describe('bulkParser — V23 (psychoacoustic bass) packet', () => {
  it('roundtrips the psybass section', () => {
    const bulk = v23Base();
    bulk.psybass = {
      enabled: true, outputMask: 0x0003, cutoffHz: 120, harmonicsDb: 6, driveDb: 9, characterPct: 75, originalDb: -3,
    };

    const bytes = buildBulkParams(bulk);
    expect(bytes.byteLength).toBe(Wire.BULK_SIZE_V23);

    const p = parseBulkParams(bytes);
    expect(p.psybass).toEqual({
      enabled: true, outputMask: 0x0003, cutoffHz: 120, harmonicsDb: 6, driveDb: 9, characterPct: 75, originalDb: -3,
    });
  });

  it('a pre-V23 packet defaults psybass to disabled / all-outputs / factory values', () => {
    const bulk = v22Base();
    const p = parseBulkParams(buildBulkParams(bulk));
    expect(p.psybass).toEqual({
      enabled: false, outputMask: 0xFFFF, cutoffHz: 80, harmonicsDb: 0, driveDb: 6, characterPct: 50, originalDb: 0,
    });
  });

  it('default V23 bulk roundtrips through build+parse cleanly', () => {
    const base = v23Base();
    expect(parseBulkParams(buildBulkParams(base))).toEqual(base);
  });
});

describe('bulkParser — V24 (ADAT input config) packet', () => {
  it('roundtrips the ADAT input sentinel fields', () => {
    const bulk = v24Base();
    bulk.inputConfig = { ...bulk.inputConfig, adatInputPin: 22, adatInputEnabledP1: 2, adatInputClockModeP1: 2 };

    const bytes = buildBulkParams(bulk);
    expect(bytes.byteLength).toBe(Wire.BULK_SIZE_V24);

    const p = parseBulkParams(bytes);
    expect(p.inputConfig.adatInputPin).toBe(22);
    expect(p.inputConfig.adatInputEnabledP1).toBe(2);
    expect(p.inputConfig.adatInputClockModeP1).toBe(2);
  });

  it('a pre-V24 packet defaults the ADAT input fields to 0 (absent)', () => {
    const bulk = v23Base();
    const p = parseBulkParams(buildBulkParams(bulk));
    expect(p.inputConfig.adatInputPin).toBe(0);
    expect(p.inputConfig.adatInputEnabledP1).toBe(0);
    expect(p.inputConfig.adatInputClockModeP1).toBe(0);
  });

  it('down-converts a V24 snapshot to V21 (qp/psybass/ADAT-input dropped, 5876 bytes)', () => {
    const bulk = v24Base();
    bulk.filters[2][3] = { type: LT, bypass: false, frequency: 45, q: 0.6, gain: 90, qpRaw: 512 };
    bulk.psybass = { ...bulk.psybass, enabled: true };
    bulk.inputConfig = { ...bulk.inputConfig, adatInputPin: 22, adatInputEnabledP1: 2, adatInputClockModeP1: 2 };

    const bytes = buildBulkParams(bulk, 21);
    expect(bytes.byteLength).toBe(Wire.BULK_SIZE_V21);

    const p = parseBulkParams(bytes);
    expect(p.formatVersion).toBe(21);
    expect(p.filters[2][3].qpRaw).toBe(0);
    expect(p.psybass.enabled).toBe(false);
    expect(p.inputConfig.adatInputPin).toBe(0);
  });

  it('default V24 bulk roundtrips through build+parse cleanly', () => {
    const base = v24Base();
    expect(parseBulkParams(buildBulkParams(base))).toEqual(base);
  });
});
