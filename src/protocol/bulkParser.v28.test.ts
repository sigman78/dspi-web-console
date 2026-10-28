// V28 (fw 1.1.5 release) codec coverage: InputConfig's interior was relaid out
// for the fourth selectable S/PDIF input. spdifRxPinExt grows to 3 entries
// (bytes 8-10), pushing every following field one byte later (enable mask 11,
// clock mode 12, ADAT 13-15). Packet total is 5944 B.

import { describe, it, expect } from 'vitest';
import { Codec } from '@/utils';
import { buildBulkParams, defaultBulkParams, parseBulkParams } from './bulkParser';
import * as Wire from './wireTypes';

function v28Base() {
  return defaultBulkParams({ platformId: 1, numCh: 17, numOut: 9, numIn: 8, formatVersion: 28 });
}

describe('bulkParser — V28 packet', () => {
  it('InputConfig decodes distinctive bytes at the relaid-out offsets and encodes back byte-identically', () => {
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
    const bytes = Codec.encode(Wire.InputConfig, value);
    expect(bytes.byteLength).toBe(16);
    expect([bytes[8], bytes[9], bytes[10]]).toEqual([20, 21, 22]);
    expect(bytes[11]).toBe(6);
    expect(bytes[12]).toBe(1);
    expect([bytes[13], bytes[14], bytes[15]]).toEqual([13, 2, 2]);

    const back = Codec.decode(Wire.InputConfig, bytes);
    expect(back).toEqual(value);
    expect(Codec.encode(Wire.InputConfig, back)).toEqual(bytes);
  });

  it('round-trips all three optional SPDIF inputs through the full bulk packet', () => {
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

  it('a V28 packet carries no V29+ sections and parses them as defaults', () => {
    const p = parseBulkParams(buildBulkParams(v28Base()));
    const def = v28Base();
    expect(p.subharm).toEqual(def.subharm);
    expect(p.tube).toEqual(def.tube);
    expect(p.limiter).toEqual(def.limiter);
  });

  it('default V28 bulk roundtrips through build+parse cleanly', () => {
    const base = v28Base();
    expect(parseBulkParams(buildBulkParams(base))).toEqual(base);
  });
});
