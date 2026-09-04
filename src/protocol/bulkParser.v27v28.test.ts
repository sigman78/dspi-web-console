// V27/V28 codec coverage: V27 widens the upmix centre-mode enum (OFF) --
// enum-only, no struct/offset/size change, so V27 round-trips exactly like
// V26. V28 relayouts InputConfig's interior for the fourth S/PDIF input:
// spdifRxPinExt grows 2->3 entries (bytes 8-10), pushing every following
// field one byte later (enable mask 11, clock mode 12, ADAT 13-15). Packet
// total stays 5944 B either way.

import { describe, it, expect } from 'vitest';
import { Codec } from '@/utils';
import { buildBulkParams, defaultBulkParams, parseBulkParams } from './bulkParser';
import * as Wire from './wireTypes';

function v27Base() {
  return defaultBulkParams({ platformId: 1, numCh: 17, numOut: 9, numIn: 8, formatVersion: 27 });
}
function v28Base() {
  return defaultBulkParams({ platformId: 1, numCh: 17, numOut: 9, numIn: 8, formatVersion: 28 });
}

describe('bulkParser — V27/V28 packet sizes', () => {
  it('BULK_SIZE_V27 and BULK_SIZE_V28 equal BULK_SIZE_V26 (enum/relayout only, no size change)', () => {
    expect(Wire.BULK_SIZE_V27).toBe(Wire.BULK_SIZE_V26);
    expect(Wire.BULK_SIZE_V28).toBe(Wire.BULK_SIZE_V26);
    expect(Wire.BULK_SIZE_V28).toBe(5944);
  });

  it('bulkSizeForVersion maps 27->5944, 28->5944', () => {
    expect(Wire.bulkSizeForVersion(27)).toBe(5944);
    expect(Wire.bulkSizeForVersion(28)).toBe(5944);
  });

  it('bulkLayout gates spdifInput4 on wire V28 AND payloadLength', () => {
    const v27 = Wire.bulkLayout({ formatVersion: 27, payloadLength: Wire.BULK_SIZE_V27 });
    expect(v27.spdifInput4).toBe(false);

    const v28 = Wire.bulkLayout({ formatVersion: 28, payloadLength: Wire.BULK_SIZE_V28 });
    expect(v28.spdifInput4).toBe(true);

    const truncated = Wire.bulkLayout({ formatVersion: 28, payloadLength: Wire.BULK_SIZE_V27 - 1 });
    expect(truncated.spdifInput4).toBe(false);
  });
});

describe('bulkParser — V27 (upmix centre OFF) packet', () => {
  it('round-trips with the exact V26 shape -- enum widening only', () => {
    const bulk = v27Base();
    bulk.upmix = { ...bulk.upmix, enabled: true, centerMode: 2, presenceDb: -3 };

    const bytes = buildBulkParams(bulk);
    expect(bytes.byteLength).toBe(Wire.BULK_SIZE_V27);

    const p = parseBulkParams(bytes);
    expect(p.formatVersion).toBe(27);
    expect(p.upmix.centerMode).toBe(2);
    expect(p.upmix.presenceDb).toBe(-3);
  });

  it('default V27 bulk roundtrips through build+parse cleanly', () => {
    const base = v27Base();
    expect(parseBulkParams(buildBulkParams(base))).toEqual(base);
  });
});

describe('bulkParser — V28 (fourth S/PDIF input) packet', () => {
  it('InputConfig28 decodes distinctive bytes at the relayouted offsets and encodes back byte-identically', () => {
    // spdifRxEnabledExtP1 6 -> mask+1 -> mask 5 (bit0+bit2: SPDIF2+SPDIF4).
    const value = {
      inputSource: 1, spdifRxPin: 5, i2sRxPin: 1, i2sInputRate: 1, i2sInputChannels: 8,
      i2sRxPinExt: [2, 3, 4],
      spdifRxPinExt: [20, 21, 22],
      spdifRxEnabledExtP1: 6,
      i2sClockMode: 1,
      adatInputPin: 13,
      adatInputEnabledP1: 2,
      adatInputClockModeP1: 2,
    };
    const bytes = Codec.encode(Wire.InputConfig28, value);
    expect(bytes.byteLength).toBe(16);
    expect([bytes[8], bytes[9], bytes[10]]).toEqual([20, 21, 22]);
    expect(bytes[11]).toBe(6);
    expect(bytes[12]).toBe(1);
    expect([bytes[13], bytes[14], bytes[15]]).toEqual([13, 2, 2]);

    const back = Codec.decode(Wire.InputConfig28, bytes);
    expect(back).toEqual(value);
    expect(Codec.encode(Wire.InputConfig28, back)).toEqual(bytes);
  });

  it('a <=V27 encode still puts the enable mask at byte 10, clock mode at 11, ADAT at 12-14', () => {
    const value = {
      inputSource: 1, spdifRxPin: 5, i2sRxPin: 1, i2sInputRate: 1, i2sInputChannels: 8,
      i2sRxPinExt: [2, 3, 4],
      spdifRxPinExt: [20, 21],
      spdifRxEnabledExtP1: 3,
      i2sClockMode: 1,
      adatInputPin: 13,
      adatInputEnabledP1: 2,
      adatInputClockModeP1: 2,
    };
    const bytes = Codec.encode(Wire.InputConfig24, value);
    expect(bytes.byteLength).toBe(16);
    expect([bytes[8], bytes[9]]).toEqual([20, 21]);
    expect(bytes[10]).toBe(3);
    expect(bytes[11]).toBe(1);
    expect([bytes[12], bytes[13], bytes[14]]).toEqual([13, 2, 2]);
    expect(bytes[15]).toBe(0);   // reserved
  });

  it('round-trips all three optional SPDIF inputs through the full bulk packet', () => {
    // spdifRxEnabledExtP1 6 -> mask 5 (SPDIF2 + SPDIF4 enabled).
    const bulk = v28Base();
    bulk.inputConfig = {
      ...bulk.inputConfig,
      spdifRxPinExt: [20, 21, 22],
      spdifRxEnabledExtP1: 6,
      adatInputPin: 13, adatInputEnabledP1: 2, adatInputClockModeP1: 2,
    };

    const bytes = buildBulkParams(bulk);
    expect(bytes.byteLength).toBe(Wire.BULK_SIZE_V28);

    const p = parseBulkParams(bytes);
    expect(p.formatVersion).toBe(28);
    expect(p.inputConfig.spdifRxPinExt).toEqual([20, 21, 22]);
    expect(p.inputConfig.spdifRxEnabledExtP1).toBe(6);
    expect(p.inputConfig.adatInputPin).toBe(13);
  });

  it('a pre-V28 packet pads the SPDIF4 slot to 0 (dropped on the old wire, not carried over)', () => {
    const bulk = v27Base();
    bulk.inputConfig = { ...bulk.inputConfig, spdifRxPinExt: [20, 21, 22], spdifRxEnabledExtP1: 6 };

    const bytes = buildBulkParams(bulk);   // writes at formatVersion 27 -- old layout
    const p = parseBulkParams(bytes);
    expect(p.formatVersion).toBe(27);
    // SPDIF4's pin has no wire home below V28; SPDIF2 (bit0) survives, but
    // SPDIF4's enable bit (bit2, part of the mask+1 byte) has no wire home either.
    expect(p.inputConfig.spdifRxPinExt).toEqual([20, 21, 0]);
  });

  it('down-converts a V28 snapshot to V26 (old 2-entry SPDIF layout, size unchanged)', () => {
    const bulk = v28Base();
    bulk.inputConfig = { ...bulk.inputConfig, spdifRxPinExt: [20, 21, 22], spdifRxEnabledExtP1: 6 };

    const bytes = buildBulkParams(bulk, 26);
    expect(bytes.byteLength).toBe(Wire.BULK_SIZE_V26);

    const p = parseBulkParams(bytes);
    expect(p.formatVersion).toBe(26);
    expect(p.inputConfig.spdifRxPinExt).toEqual([20, 21, 0]);
  });

  it('default V28 bulk roundtrips through build+parse cleanly', () => {
    const base = v28Base();
    expect(parseBulkParams(buildBulkParams(base))).toEqual(base);
  });
});
