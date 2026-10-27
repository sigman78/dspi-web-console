import { describe, it, expect } from 'vitest';
import type { PresetSlot } from '@/domain';
import { editorActions } from './editorActions';

const base = { active: 2 as PresetSlot, occupied: true, dirty: false, held: null };

describe('editorActions', () => {
  it('offers save without revert for an unoccupied slot', () => {
    expect(editorActions({ ...base, occupied: false })).toEqual(['save', 'import']);
  });
  it('offers save and revert instead of copy when dirty', () => {
    expect(editorActions({ ...base, dirty: true })).toEqual(['save', 'revert', 'export', 'import']);
  });
  it('offers copy when clean and paste only for a clipboard from another slot', () => {
    expect(editorActions(base)).toEqual(['copy', 'export', 'import']);
    expect(editorActions({ ...base, held: { slot: 2 as PresetSlot } })).not.toContain('paste');
    expect(editorActions({ ...base, held: { slot: 5 as PresetSlot } })).toContain('paste');
  });
});
