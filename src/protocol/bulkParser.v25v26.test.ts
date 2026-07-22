// V25/V26 codec coverage: the stereo upmixer section (V25, appended section,
// packet grows to 5944 B) and the presence-bell byte (V26, UpmixParams
// reserved-byte claim, no further size change).

import { describe, it, expect } from 'vitest';
import { buildBulkParams, defaultBulkParams, parseBulkParams } from './bulkParser';
import * as Wire from './wireTypes';

function v24Base() {
  return defaultBulkParams({ platformId: 1, numCh: 17, numOut: 9, numIn: 8, formatVersion: 24 });
}
function v25Base() {
  return defaultBulkParams({ platformId: 1, numCh: 17, numOut: 9, numIn: 8, formatVersion: 25 });
}
function v26Base() {
  return defaultBulkParams({ platformId: 1, numCh: 17, numOut: 9, numIn: 8, formatVersion: 26 });
}

describe('bulkParser — V25/V26 packet sizes', () => {
  it('BULK_SIZE_V25 grows by the 44-byte upmix section', () => {
    expect(Wire.BULK_SIZE_V25).toBe(Wire.BULK_SIZE_V24 + 44);
    expect(Wire.BULK_SIZE_V25).toBe(5944);
  });

  it('BULK_SIZE_V26 equals BULK_SIZE_V25 (no packet-size change)', () => {
    expect(Wire.BULK_SIZE_V26).toBe(Wire.BULK_SIZE_V25);
  });

  it('bulkSizeForVersion maps 24->5900, 25->5944, 26->5944, 99->5944', () => {
    expect(Wire.bulkSizeForVersion(24)).toBe(5900);
    expect(Wire.bulkSizeForVersion(25)).toBe(5944);
    expect(Wire.bulkSizeForVersion(26)).toBe(5944);
    expect(Wire.bulkSizeForVersion(99)).toBe(5944);
  });

  it('sectionLayout gates upmix on wire V25 AND payloadLength, upmixPresence on V26', () => {
    const v24 = Wire.bulkLayout({ formatVersion: 24, payloadLength: Wire.BULK_SIZE_V24 });
    expect(v24.upmix).toBe(false);
    expect(v24.upmixPresence).toBe(false);

    const v25 = Wire.bulkLayout({ formatVersion: 25, payloadLength: Wire.BULK_SIZE_V25 });
    expect(v25.upmix).toBe(true);
    expect(v25.upmixPresence).toBe(false);

    const v26 = Wire.bulkLayout({ formatVersion: 26, payloadLength: Wire.BULK_SIZE_V26 });
    expect(v26.upmix).toBe(true);
    expect(v26.upmixPresence).toBe(true);

    const truncated = Wire.bulkLayout({ formatVersion: 26, payloadLength: Wire.BULK_SIZE_V25 - 1 });
    expect(truncated.upmix).toBe(false);
    expect(truncated.upmixPresence).toBe(false);
  });
});

describe('bulkParser — V25 (stereo upmixer) packet', () => {
  it('roundtrips a non-default upmix config, forcing presence to 0 even if staged nonzero', () => {
    const bulk = v25Base();
    bulk.upmix = {
      enabled: true, centerMode: 0, surroundMode: 1,
      strengthPct: 65, centerWidthPct: 40, corrThresholdPct: 45,
      attackMs: 5, releaseMs: 250, detectorHpfHz: 150,
      surroundDelayMs: 20, surroundHpfHz: 400, surroundLpfHz: 6000,
      decorrPct: 70, presenceDb: -7.5,
    };

    const bytes = buildBulkParams(bulk);
    expect(bytes.byteLength).toBe(Wire.BULK_SIZE_V25);

    const p = parseBulkParams(bytes);
    expect(p.upmix).toEqual({
      enabled: true, centerMode: 0, surroundMode: 1,
      strengthPct: 65, centerWidthPct: 40, corrThresholdPct: 45,
      attackMs: 5, releaseMs: 250, detectorHpfHz: 150,
      surroundDelayMs: 20, surroundHpfHz: 400, surroundLpfHz: 6000,
      decorrPct: 70, presenceDb: 0,
    });
  });

  it('a pre-V25 packet defaults upmix to disabled / firmware defaults', () => {
    const bulk = v24Base();
    const p = parseBulkParams(buildBulkParams(bulk));
    expect(p.upmix).toEqual({
      enabled: false, centerMode: 1, surroundMode: 2,
      strengthPct: 100, centerWidthPct: 25, corrThresholdPct: 30,
      attackMs: 10, releaseMs: 100, detectorHpfHz: 200,
      surroundDelayMs: 12, surroundHpfHz: 300, surroundLpfHz: 7000,
      decorrPct: 90, presenceDb: 0,
    });
  });

  it('default V25 bulk roundtrips through build+parse cleanly', () => {
    const base = v25Base();
    expect(parseBulkParams(buildBulkParams(base))).toEqual(base);
  });
});

describe('bulkParser — V26 (upmixer presence bell) packet', () => {
  it('roundtrips a negative presenceDb through the presenceQ1 int8 sidecar', () => {
    const bulk = v26Base();
    bulk.upmix = { ...bulk.upmix, presenceDb: -7.5 };

    const bytes = buildBulkParams(bulk);
    expect(bytes.byteLength).toBe(Wire.BULK_SIZE_V26);

    const p = parseBulkParams(bytes);
    expect(p.upmix.presenceDb).toBe(-7.5);
  });

  it('down-converts a V26 snapshot to V24 (upmix section dropped, 5900 bytes)', () => {
    const bulk = v26Base();
    bulk.upmix = { ...bulk.upmix, enabled: true, presenceDb: 6 };

    const bytes = buildBulkParams(bulk, 24);
    expect(bytes.byteLength).toBe(Wire.BULK_SIZE_V24);

    const p = parseBulkParams(bytes);
    expect(p.formatVersion).toBe(24);
    expect(p.upmix.enabled).toBe(false);
    expect(p.upmix.presenceDb).toBe(0);
  });

  it('default V26 bulk roundtrips through build+parse cleanly', () => {
    const base = v26Base();
    expect(parseBulkParams(buildBulkParams(base))).toEqual(base);
  });
});
