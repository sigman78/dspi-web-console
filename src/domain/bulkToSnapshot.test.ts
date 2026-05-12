import { describe, expect, it } from 'vitest';
import { parseBulkParams } from '../protocol/bulkParser';
import { synthesizeBulkParams } from '../protocol/bulkParser.syn';
import { PlatformType } from './platform';
import { fromBulkParams } from './bulkToSnapshot';
import { matrixColumns, matrixRows } from './mixerView';

describe('fromBulkParams', () => {
  it('maps protocol bulk data into an RP2350 domain snapshot', () => {
    const bulk = parseBulkParams(synthesizeBulkParams({
      platformId: 1,
      channelNames: ['', '', 'Left Woofer'],
      masterVolumeDb: -12.5,
      i2s: {
        outputSlotTypes: [1, 0, 0, 0],
        bckPin: 10,
        mckPin: 11,
        mckEnabled: true,
        mckMultiplierEncoded: 1,
      },
    }));
    const snapshot = fromBulkParams(PlatformType.RP2350, bulk);

    expect(snapshot.platform.name).toBe('RP2350');
    expect(snapshot.outputs).toHaveLength(9);
    expect(snapshot.channels).toHaveLength(11);
    expect(snapshot.masterVolumeDb).toBeCloseTo(-12.5);
    expect(snapshot.outputs[0].name).toBe('Left Woofer');
    expect(snapshot.channels[0].outputMode).toBeNull();
    expect(snapshot.outputs[0].outputMode).toBe('I2S');
    expect(snapshot.outputs[8].outputMode).toBe('PDM');
    expect(snapshot.routes).toHaveLength(18);
  });

  it('selectors expose view-ready matrix and meter models', () => {
    const bulk = parseBulkParams(synthesizeBulkParams({ platformId: 0 }));
    const snapshot = fromBulkParams(PlatformType.RP2040, bulk);

    expect(matrixColumns(snapshot)).toHaveLength(5);
    expect(matrixRows(snapshot)).toHaveLength(2);
    expect(matrixRows(snapshot)[0].cells).toHaveLength(5);
    expect(snapshot.channels ?? []).toHaveLength(7);
  });
});
