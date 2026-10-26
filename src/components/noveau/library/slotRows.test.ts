import { describe, expect, it } from 'vitest';
import type { PresetSlot } from '@/domain';
import { slotRows } from './slotRows';

const slots = [0, 1, 2] as PresetSlot[];

describe('slotRows', () => {
  it('marks dirty only on the active slot and copied only on the clipboard slot', () => {
    const rows = slotRows({
      slots, names: ['A', null, 'C'], occupied: new Set<PresetSlot>([0, 2]),
      active: 2 as PresetSlot, startup: 0 as PresetSlot, dirty: true, copiedSlot: 0 as PresetSlot,
    });
    expect(rows.map((r) => r.dirty)).toEqual([false, false, true]);
    expect(rows.map((r) => r.copied)).toEqual([true, false, false]);
    expect(rows.map((r) => r.startup)).toEqual([true, false, false]);
    expect(rows.map((r) => r.occupied)).toEqual([true, false, true]);
    expect(rows[1].name).toBe('');
  });

  it('treats an unfetched directory as all-empty and no active slot as no dirty', () => {
    const rows = slotRows({
      slots, names: [], occupied: null, active: null, startup: null, dirty: true, copiedSlot: null,
    });
    expect(rows.every((r) => !r.occupied && !r.dirty && !r.active && !r.copied)).toBe(true);
  });
});
