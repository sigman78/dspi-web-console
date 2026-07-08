import { describe, it, expect } from 'vitest';
import { matrixColumns, matrixRows } from './mixerView';
import { makeSnapshot } from '@test/fixtures/snapshotFixtures';

describe('matrixColumns / matrixRows — enabled-output filtering', () => {
  it('hides disabled outputs, keeping a half-enabled pair\'s enabled slot only', () => {
    // Out1L(0) enabled, Out1R(1) disabled -- half-enabled pair.
    // Out2*(2,3) and Out4*(6,7) fully disabled, Out3L(4) enabled, PDM(8) enabled.
    const snap = makeSnapshot((b) => {
      b.outputs = b.outputs.map((o, i) => ({ ...o, enabled: i === 0 || i === 4 || i === 8 }));
    });

    const columns = matrixColumns(snap);
    expect(columns.map((c) => c.wireIdx)).toEqual([0, 4, 8]);
  });

  it('aligns each row\'s cells with matrixColumns in the same order, not by route-list position', () => {
    const snap = makeSnapshot((b) => {
      b.outputs = b.outputs.map((o, i) => ({ ...o, enabled: i === 0 || i === 4 || i === 8 }));
    });

    const columns = matrixColumns(snap);
    const rows = matrixRows(snap);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.cells.map((c) => c.outputWireIndex)).toEqual(columns.map((c) => c.wireIdx));
    }
  });

  it('yields no columns and empty row cells when every output is disabled', () => {
    const snap = makeSnapshot((b) => {
      b.outputs = b.outputs.map((o) => ({ ...o, enabled: false }));
    });
    expect(matrixColumns(snap)).toEqual([]);
    for (const row of matrixRows(snap)) {
      expect(row.cells).toEqual([]);
    }
  });
});
