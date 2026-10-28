import type * as Domain from '@/domain';
import * as CsField from '@/domain/cs/fieldHelpers';

export type ControlPageKey = 'interfaces' | 'surfaces' | 'macros' | 'display';

export const CONTROL_PAGE_KEYS: readonly ControlPageKey[] = ['interfaces', 'surfaces', 'macros', 'display'];

export interface ControlPage {
  key: ControlPageKey;
  label: string;
}

interface ControlFeatures {
  controlInterfaces: boolean;
  controlSurfaces: boolean;
}

/** CONTROL has at least one page exactly when the interfaces page is available. */
export function controlAvailable(features: ControlFeatures): boolean {
  return features.controlInterfaces || features.controlSurfaces;
}

/** Pages with at least one available panel, in selector order. */
export function controlPages(features: ControlFeatures, caps: Domain.CsCaps | null): ControlPage[] {
  const cs = features.controlSurfaces;
  const all: Array<ControlPage & { available: boolean }> = [
    { key: 'interfaces', label: 'INTERFACES', available: features.controlInterfaces || cs },
    { key: 'surfaces', label: 'SURFACES', available: cs },
    { key: 'macros', label: 'MACROS & GROUPS', available: cs && (CsField.macrosAvailable(caps) || CsField.groupsAvailable(caps)) },
    { key: 'display', label: 'DISPLAY', available: cs && CsField.displaysAvailable(caps) },
  ];
  return all.filter((p) => p.available).map(({ key, label }) => ({ key, label }));
}
