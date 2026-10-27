import type { ReadySession } from '@/state';
import * as CsField from '@/domain/cs/fieldHelpers';

export function csChangesModel(s: ReadySession) {
  const cs = s.controlSurfaces;
  const caps = cs.caps;
  const areas = [
    { key: 'bindings' as const, label: 'controls', show: true, drafts: ['cs', 'ir'] as const },
    { key: 'groups' as const, label: 'groups', show: CsField.groupsAvailable(caps), drafts: ['groups'] as const },
    { key: 'macros' as const, label: 'macros', show: CsField.macrosAvailable(caps), drafts: ['macros'] as const },
    { key: 'display' as const, label: 'display', show: CsField.displaysAvailable(caps), drafts: ['display'] as const },
  ].filter((a) => a.show);
  const draftCount = (a: (typeof areas)[number]): number => a.drafts.reduce((n, f) => n + s.drafts.dirtyCount(f), 0);
  return {
    dirty: cs.status?.dirty === true,
    areas,
    changedText: areas.filter((a) => cs.changed[a.key]).map((a) => a.label).join(', '),
    draftTotal: areas.reduce((n, a) => n + draftCount(a), 0),
    draftText: areas.filter((a) => draftCount(a) > 0).map((a) => `${a.label} ${draftCount(a)}`).join(', '),
  };
}
