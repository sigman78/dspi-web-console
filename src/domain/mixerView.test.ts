import { describe, it, expect } from 'vitest';
import { matrixColumns, matrixRows } from './mixerView';
import { createHardwareProfile, PlatformType, ChannelFamily } from './platform';
import { UpmixSurroundMode } from './processing';
import { makeSnapshot } from '@test/fixtures/snapshotFixtures';

// V16 Unified RP2350: the only profile with the extra input slots (In2*/In3*)
// the upmixer repurposes as derived-channel busses.
const RP2350_UNIFIED = createHardwareProfile(PlatformType.RP2350, ChannelFamily.Unified);

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

describe('matrixRows — upmix contextual row labels', () => {
  it('leaves rows unlabeled when upmix is disabled (and the idle input rows stay hidden)', () => {
    const snap = makeSnapshot(undefined, RP2350_UNIFIED);
    const rows = matrixRows(snap, 2, { enabled: false, surroundMode: UpmixSurroundMode.Off });
    expect(rows.length).toBe(2);
  });

  it('leaves rows unlabeled on a multichannel (non-stereo) active input', () => {
    const snap = makeSnapshot(undefined, RP2350_UNIFIED);
    const rows = matrixRows(snap, 6, { enabled: true, surroundMode: UpmixSurroundMode.Adaptive });
    expect(rows[2].label).not.toBe('Upmix C');
    expect(rows[3].label).not.toBe('Upmix Ls');
  });

  it('labels row 2 as Upmix C whenever enabled over a stereo input, and hides rows 3/4 when surround is OFF', () => {
    const snap = makeSnapshot(undefined, RP2350_UNIFIED);
    const rows = matrixRows(snap, 2, { enabled: true, surroundMode: UpmixSurroundMode.Off });
    expect(rows[2].label).toBe('Upmix C');
    // Surround off: those rows carry no signal (not summed into outputs), so
    // they stay hidden like any other silent input row.
    expect(rows.length).toBe(3);
  });

  it('labels rows 3/4 as Upmix Ls/Rs when surround mode is not OFF', () => {
    const snap = makeSnapshot(undefined, RP2350_UNIFIED);
    const rows = matrixRows(snap, 2, { enabled: true, surroundMode: UpmixSurroundMode.Passive });
    expect(rows[2].label).toBe('Upmix C');
    expect(rows[3].label).toBe('Upmix Ls');
    expect(rows[4].label).toBe('Upmix Rs');
  });

  it('bumps the shown row count past activeInputs so the derived rows stay visible', () => {
    const snap = makeSnapshot(undefined, RP2350_UNIFIED);
    // activeInputs=2 would normally hide every row past index 1.
    const rows = matrixRows(snap, 2, { enabled: true, surroundMode: UpmixSurroundMode.Adaptive });
    expect(rows.length).toBeGreaterThanOrEqual(5);
  });

  it('keeps real input names in multichannel input modes', () => {
    const snap = makeSnapshot(undefined, RP2350_UNIFIED);
    const rows = matrixRows(snap, 8, { enabled: true, surroundMode: UpmixSurroundMode.Adaptive });
    // 8 live inputs is genuinely multichannel, not a repurposed stereo pair --
    // row 2's real channel name must survive, not the derived-channel label.
    expect(rows[2].label).toBe(snap.channels.find((c) => c.id === rows[2].inputId)!.name);
    expect(rows[2].label).not.toBe('Upmix C');
  });
});
