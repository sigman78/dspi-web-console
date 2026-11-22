// V34 (paged firmware) packet: same sizes as V32, but the S/PDIF-enable and
// ADAT-enable bytes of the input config become the S/PDIF count and the input
// block switches.

import { describe, it, expect } from 'vitest';
import * as BulkParser from './bulkParser';
import * as Wire from './wireTypes';

function base(extP1: number, adatP1: number) {
  const bulk = BulkParser.defaultBulkParams({ platformId: 1, numCh: 17, numOut: 9, numIn: 8, formatVersion: 34 });
  bulk.inputConfig.spdifRxEnabledExtP1 = extP1;
  bulk.inputConfig.adatInputEnabledP1 = adatP1;
  return bulk;
}

function bulkOf(inputConfig: ReturnType<typeof base>['inputConfig']) {
  return { ...base(0, 0), inputConfig };
}

// Bytes that differ between two packets built from the same state.
function changedBytes(a: Uint8Array, b: Uint8Array): { at: number; a: number; b: number }[] {
  return [...a].flatMap((v, i) => (v === b[i] ? [] : [{ at: i, a: v, b: b[i] }]));
}

describe('bulkParser V34', () => {
  it('has the V32 size and sections', () => {
    expect(Wire.bulkSizeForVersion(34)).toBe(6136);
    expect(BulkParser.buildBulkParams(base(1, 1)).byteLength).toBe(6136);
    expect(Wire.bulkLayout({ formatVersion: 34, payloadLength: 6136 }).limiter).toBe(true);
  });

  it('reads the count and block switches as the V32 meanings and keeps the raw bytes', () => {
    // Three S/PDIF inputs, S/PDIF + ADAT on (mask 5, +1).
    const bulk = base(0b11 + 1, 2);
    bulk.inputConfig.blocks = { spdifRxCount: 3, inputEnableP1: 6 };
    const parsed = BulkParser.parseBulkParams(BulkParser.buildBulkParams(bulk));
    expect(parsed.inputConfig.blocks).toEqual({ spdifRxCount: 3, inputEnableP1: 6 });
    expect(parsed.inputConfig.spdifRxEnabledExtP1).toBe(0b11 + 1);
    expect(parsed.inputConfig.adatInputEnabledP1).toBe(2);
  });

  it('treats a switched-off S/PDIF block as no extra inputs enabled, and absent bytes as absent', () => {
    const off = base(1, 1);
    off.inputConfig.blocks = { spdifRxCount: 4, inputEnableP1: 3 };   // I2S only
    const p = BulkParser.parseBulkParams(BulkParser.buildBulkParams(off)).inputConfig;
    expect([p.spdifRxEnabledExtP1, p.adatInputEnabledP1]).toEqual([1, 1]);
    expect(p.blocks).toEqual({ spdifRxCount: 4, inputEnableP1: 3 });

    const none = base(0, 0);
    none.inputConfig.blocks = { spdifRxCount: 0, inputEnableP1: 0 };
    const q = BulkParser.parseBulkParams(BulkParser.buildBulkParams(none)).inputConfig;
    expect([q.spdifRxEnabledExtP1, q.adatInputEnabledP1]).toEqual([0, 0]);
  });

  it('writes the raw bytes back as read', () => {
    const bulk = base(2, 2);
    bulk.inputConfig.blocks = { spdifRxCount: 2, inputEnableP1: 8 };
    const bytes = BulkParser.buildBulkParams(bulk);
    expect(BulkParser.buildBulkParams(BulkParser.parseBulkParams(bytes))).toEqual(bytes);
  });

  // Mirrors firmware input_blocks_from_legacy(): input 1 plus every ext input up
  // to the highest enabled; I2S starts off and is on only while it is the
  // selected source (flash_storage.c restore keeps the selected block on). An
  // absent field stays absent so the firmware keeps its live value.
  it('derives the bytes from the V32 fields by the firmware migration rule', () => {
    const derive = (extP1: number, adatP1: number, source = 0) => {
      const bulk = base(extP1, adatP1);
      bulk.inputConfig.source = source;
      return BulkParser.parseBulkParams(BulkParser.buildBulkParams(bulk)).inputConfig.blocks;
    };
    // Ext inputs 2 and 4 enabled (mask 0b101): the block spans four inputs. ADAT on, I2S off.
    expect(derive(0b101 + 1, 2)).toEqual({ spdifRxCount: 4, inputEnableP1: 1 + (1 | 4) });
    // The same with I2S selected.
    expect(derive(0b101 + 1, 2, 2)).toEqual({ spdifRxCount: 4, inputEnableP1: 1 + (1 | 2 | 4) });
    // No ext input enabled, ADAT off: input 1 alone.
    expect(derive(1, 1)).toEqual({ spdifRxCount: 1, inputEnableP1: 1 + 1 });
    // Both source fields absent (RP2040): both bytes absent.
    expect(derive(0, 0)).toEqual({ spdifRxCount: 0, inputEnableP1: 0 });
    // Each byte follows its own field.
    expect(derive(0, 1)).toEqual({ spdifRxCount: 0, inputEnableP1: 2 });
    expect(derive(3, 0)).toEqual({ spdifRxCount: 3, inputEnableP1: 0 });
  });

  it('derives instead of echoing raw bytes once the V32 fields were edited after the read', () => {
    const bulk = base(1, 2);
    bulk.inputConfig.blocks = { spdifRxCount: 3, inputEnableP1: 7 };   // S/PDIF block off in the raw bytes
    const read = BulkParser.parseBulkParams(BulkParser.buildBulkParams(bulk)).inputConfig;
    expect(read.spdifRxEnabledExtP1).toBe(1);

    const untouched = BulkParser.parseBulkParams(BulkParser.buildBulkParams({ ...bulkOf(read) })).inputConfig.blocks;
    expect(untouched).toEqual({ spdifRxCount: 3, inputEnableP1: 7 });

    const edited = bulkOf({ ...read, spdifRxEnabledExtP1: 0b1 + 1 });
    expect(BulkParser.parseBulkParams(BulkParser.buildBulkParams(edited)).inputConfig.blocks).toEqual({ spdifRxCount: 2, inputEnableP1: 1 + (1 | 4) });
  });

  it('changes only the version byte and the two input-block bytes relative to V32', () => {
    const state = base(0b11 + 1, 2);
    const diff = changedBytes(BulkParser.buildBulkParams(state, 32), BulkParser.buildBulkParams(state, 34));
    expect(diff).toHaveLength(3);
    expect(diff.find((d) => d.at === 0)?.b).toBe(34);
    // Count: input 1 plus two ext inputs; switches: S/PDIF and ADAT (USB source), plus one.
    expect(diff.filter((d) => d.at !== 0).map((d) => [d.a, d.b])).toEqual([[0b11 + 1, 3], [2, 1 + 5]]);
  });

  it('never writes V33: it clamps to the legacy ceiling', () => {
    expect(BulkParser.parseBulkParams(BulkParser.buildBulkParams(base(1, 1), 33)).formatVersion).toBe(32);
  });
});

describe('inputBlockState', () => {
  const stateOf = (blocks: { spdifRxCount: number; inputEnableP1: number }) => {
    const bulk = base(1, 1);
    bulk.inputConfig.blocks = blocks;
    Object.assign(bulk.inputConfig, BulkParser.blocksToLegacyFields(blocks));
    return BulkParser.inputBlockState(BulkParser.parseBulkParams(BulkParser.buildBulkParams(bulk)).inputConfig);
  };

  it('reads the switches from the V34 bytes', () => {
    expect(stateOf({ spdifRxCount: 3, inputEnableP1: 1 + (1 | 2) })).toEqual({ spdifEnabled: true, spdifCount: 3, i2sEnabled: true });
    expect(stateOf({ spdifRxCount: 4, inputEnableP1: 1 + 2 })).toEqual({ spdifEnabled: false, spdifCount: 4, i2sEnabled: true });
    expect(stateOf({ spdifRxCount: 2, inputEnableP1: 1 + 4 })).toEqual({ spdifEnabled: false, spdifCount: 2, i2sEnabled: false });
  });

  it('reads absent bytes as one S/PDIF input on and I2S off', () => {
    expect(stateOf({ spdifRxCount: 0, inputEnableP1: 0 })).toEqual({ spdifEnabled: true, spdifCount: 1, i2sEnabled: false });
  });

  it('closes a gappy legacy mask up to the highest enabled input, with both blocks always on', () => {
    const legacy = (extP1: number) => {
      const bulk = BulkParser.defaultBulkParams({ platformId: 1, numCh: 17, numOut: 9, numIn: 8 });
      bulk.inputConfig.spdifRxEnabledExtP1 = extP1;
      return BulkParser.inputBlockState(BulkParser.parseBulkParams(BulkParser.buildBulkParams(bulk)).inputConfig);
    };
    expect(legacy(0b100 + 1)).toEqual({ spdifEnabled: true, spdifCount: 4, i2sEnabled: true });
    expect(legacy(1)).toEqual({ spdifEnabled: true, spdifCount: 1, i2sEnabled: true });
    expect(legacy(0).spdifCount).toBe(1);
  });
});
