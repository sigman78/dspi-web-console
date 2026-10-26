import type { PresetSlot } from '@/domain';
import type { SlotRow } from './slotRows';

export type RowActionId =
  | 'save' | 'revert' | 'copy' | 'paste' | 'load' | 'drop' | 'export' | 'import' | 'delete';

export interface RowAction {
  id: RowActionId;
  label: string;
  tone?: 'accent';
  quiet: boolean;
  icon?: 'save' | 'revert';
}

export interface RowActionsInput {
  row: SlotRow;
  held: { slot: PresetSlot } | null;
}

const LABELS: Record<RowActionId, string> = {
  save: 'SAVE', revert: 'REVERT', copy: 'COPY', paste: 'PASTE', load: 'LOAD',
  drop: 'DROP', export: 'EXPORT', import: 'IMPORT', delete: 'DELETE',
};

export function rowActions({ row, held }: RowActionsInput): RowAction[] {
  const ids: RowActionId[] = [];
  if (row.active) {
    if (row.dirty || !row.occupied) ids.push('save');
    if (row.occupied && row.dirty) ids.push('revert');
    if (row.occupied && !row.dirty && held == null) ids.push('copy');
  } else if (row.occupied) {
    ids.push('load');
  }
  if (held != null && held.slot !== row.slot) ids.push('paste');
  if (row.copied) ids.push('drop', 'export');
  if (!row.occupied) ids.push('import');
  if (!row.active && row.occupied) ids.push('delete');
  return ids.map((id) => ({
    id,
    label: LABELS[id],
    tone: id === 'save' || id === 'paste' || id === 'drop' ? 'accent' : undefined,
    quiet: id !== 'save' && id !== 'revert',
    icon: id === 'save' || id === 'revert' ? id : undefined,
  }));
}
