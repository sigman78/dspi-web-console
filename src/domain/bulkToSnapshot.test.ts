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
    expect(snapshot.outputs[8].wireIndex).toBe(8);
    expect(snapshot.routes).toHaveLength(18);
  });

  it('maps RP2040 PDM to compact matrix slot 4', () => {
    const outputs = Array.from({ length: 9 }, () => ({
      enabled: false,
      muted: false,
      gainDb: 0,
      delayMs: 0,
    }));
    outputs[4] = { enabled: true, muted: false, gainDb: -4, delayMs: 1.25 };
    outputs[8] = { enabled: false, muted: true, gainDb: -8, delayMs: 8.5 };

    const crosspoints = Array.from({ length: 2 }, () =>
      Array.from({ length: 9 }, () => ({ enabled: false, invert: false, gainDb: 0 })),
    );
    crosspoints[0][4] = { enabled: true, invert: true, gainDb: -3 };
    crosspoints[0][8] = { enabled: false, invert: false, gainDb: -9 };

    const bulk = parseBulkParams(synthesizeBulkParams({ platformId: 0, outputs, crosspoints }));
    const snapshot = fromBulkParams(PlatformType.RP2040, bulk);
    const pdm = snapshot.outputs.find((output) => output.id === 10);
    const pdmRoute = snapshot.routes.find((route) => route.inputIndex === 0 && route.outputId === 10);

    expect(matrixColumns(snapshot)).toHaveLength(5);
    expect(matrixRows(snapshot)).toHaveLength(2);
    expect(matrixRows(snapshot)[0].cells).toHaveLength(5);
    expect(snapshot.channels ?? []).toHaveLength(7);
    expect(pdm?.wireIndex).toBe(4);
    expect(pdm?.enabled).toBe(true);
    expect(pdm?.gainDb).toBeCloseTo(-4);
    expect(pdmRoute?.outputWireIndex).toBe(4);
    expect(pdmRoute?.enabled).toBe(true);
    expect(pdmRoute?.invert).toBe(true);
  });
});
