import type * as Domain from '@/domain';
import * as CsField from '@/components/system/csFieldHelpers';

export type SetupPageKey = 'device' | 'io' | 'interfaces' | 'surfaces' | 'macros' | 'display';

export interface SetupPage {
  key: SetupPageKey;
  label: string;
}

interface SetupFeatures {
  controlInterfaces: boolean;
  controlSurfaces: boolean;
}

/** Pages with at least one available panel, in selector order. */
export function setupPages(features: SetupFeatures, caps: Domain.CsCaps | null): SetupPage[] {
  const cs = features.controlSurfaces;
  const all: Array<SetupPage & { available: boolean }> = [
    { key: 'device', label: 'DEVICE', available: true },
    { key: 'io', label: 'I/O', available: true },
    { key: 'interfaces', label: 'INTERFACES', available: features.controlInterfaces || cs },
    { key: 'surfaces', label: 'SURFACES', available: cs },
    { key: 'macros', label: 'MACROS & GROUPS', available: cs && (CsField.macrosAvailable(caps) || CsField.groupsAvailable(caps)) },
    { key: 'display', label: 'DISPLAY', available: cs && CsField.displaysAvailable(caps) },
  ];
  return all.filter((p) => p.available).map(({ key, label }) => ({ key, label }));
}
