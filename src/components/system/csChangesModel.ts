import type { ReadySession } from '@/state';
import * as CsField from './csFieldHelpers';

export function csChangesModel(s: ReadySession) {
  const cs = s.controlSurfaces;
  const caps = cs.caps;
  const areas = [
    { key: 'bindings' as const, label: 'controls', show: true },
    { key: 'groups' as const, label: 'groups', show: CsField.groupsAvailable(caps) },
    { key: 'macros' as const, label: 'macros', show: CsField.macrosAvailable(caps) },
    { key: 'display' as const, label: 'display', show: CsField.displaysAvailable(caps) },
  ].filter((a) => a.show);
  return {
    dirty: cs.status?.dirty === true,
    areas,
    changedText: areas.filter((a) => cs.changed[a.key]).map((a) => a.label).join(', '),
    stagedTotal: areas.reduce((n, a) => n + cs.staged[a.key], 0),
    stagedText: areas.filter((a) => cs.staged[a.key] > 0).map((a) => `${a.label} ${cs.staged[a.key]}`).join(', '),
  };
}
