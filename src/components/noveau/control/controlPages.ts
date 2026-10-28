import type * as Domain from '@/domain';
import type { DraftFamily } from '@/state';
import * as CsField from '@/domain/cs/fieldHelpers';

export type ControlPageKey = 'surfaces' | 'macros' | 'display';

export interface ControlPage {
  key: ControlPageKey;
  label: string;
}

/** Draft families whose unapplied edits a CONTROL page holds. */
export const CONTROL_PAGE_DRAFTS: Record<ControlPageKey, readonly DraftFamily[]> = {
  surfaces: ['cs', 'ir'],
  macros: ['macros', 'groups'],
  display: ['display'],
};

/** Pages with at least one available panel, in selector order. */
export function controlPages(caps: Domain.CsCaps | null): ControlPage[] {
  const all: Array<ControlPage & { available: boolean }> = [
    { key: 'surfaces', label: 'SURFACES', available: true },
    { key: 'macros', label: 'MACROS & GROUPS', available: CsField.macrosAvailable(caps) || CsField.groupsAvailable(caps) },
    { key: 'display', label: 'DISPLAY', available: CsField.displaysAvailable(caps) },
  ];
  return all.filter((p) => p.available).map(({ key, label }) => ({ key, label }));
}
