import { describe, expect, it } from 'vitest';
import type { PresetSlot } from '@/domain';
import { rowActions } from './rowActions';
import type { SlotRow } from './slotRows';

const base: SlotRow = {
  slot: 3 as PresetSlot, name: 'x', occupied: true, active: false, startup: false, dirty: false, copied: false,
};
const ids = (row: Partial<SlotRow>, held: PresetSlot | null = null) =>
  rowActions({
    row: { ...base, ...row },
    held: held == null ? null : { slot: held },
  }).map((a) => a.id);

describe('rowActions', () => {
  it('offers SAVE and REVERT instead of COPY while the active slot is dirty', () => {
    expect(ids({ active: true, dirty: true })).toEqual(['save', 'revert']);
    expect(ids({ active: true })).toEqual(['copy']);
  });

  it('offers SAVE and IMPORT on an active slot that was never stored', () => {
    expect(ids({ active: true, occupied: false })).toEqual(['save', 'import']);
  });

  it('hides COPY once the clipboard is taken, and puts DROP/EXPORT on the source row only', () => {
    expect(ids({ active: true, copied: true }, 3 as PresetSlot)).toEqual(['drop', 'export']);
    expect(ids({ active: true }, 5 as PresetSlot)).toEqual(['paste']);
  });

  it('never offers PASTE onto the clipboard source itself', () => {
    expect(ids({ copied: true }, 3 as PresetSlot)).toEqual(['load', 'drop', 'export', 'delete']);
    expect(ids({}, 5 as PresetSlot)).toEqual(['load', 'paste', 'delete']);
  });

  it('empty rows offer PASTE only with a clipboard, and always IMPORT', () => {
    expect(ids({ occupied: false })).toEqual(['import']);
    expect(ids({ occupied: false }, 5 as PresetSlot)).toEqual(['paste', 'import']);
  });

  it('keeps only SAVE and REVERT always visible', () => {
    const quiet = (row: Partial<SlotRow>) =>
      rowActions({ row: { ...base, ...row }, held: null }).filter((a) => a.quiet).map((a) => a.id);
    expect(quiet({ active: true, dirty: true })).toEqual([]);
    expect(quiet({})).toEqual(['load', 'delete']);
  });
});
