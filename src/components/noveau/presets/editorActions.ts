import type { PresetSlot } from '@/domain';

export type EditorActionId = 'save' | 'revert' | 'copy' | 'paste' | 'export' | 'import';

export interface EditorActionsInput {
  active: PresetSlot;
  occupied: boolean;
  dirty: boolean;
  held: { slot: PresetSlot } | null;
}

export function editorActions({ active, occupied, dirty, held }: EditorActionsInput): EditorActionId[] {
  const ids: EditorActionId[] = [];
  if (dirty || !occupied) ids.push('save');
  if (occupied && dirty) ids.push('revert');
  if (occupied && !dirty) ids.push('copy');
  if (held != null && held.slot !== active) ids.push('paste');
  if (occupied) ids.push('export');
  ids.push('import');
  return ids;
}

// Replacing an occupied slot asks first, except when unsaved changes are
// pending: the boundary modal already covers that case.
export function replaceNeedsConfirm(occupied: boolean, dirty: boolean): boolean {
  return occupied && !dirty;
}
