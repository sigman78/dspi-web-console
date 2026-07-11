// Reactive store for the V16 Control Surfaces feature (0x84-0x87): caps
// tables, per-slot bindings, and live status. Not part of the bulk packet --
// fetched once at connect via its own vendor commands (see
// runtime/deviceService.ts), like ctrlIfaces.

import { CS_MAX_BINDINGS, type CsBinding, type CsCaps, type CsNounCaps, type CsStatus } from '@/domain';

export interface ControlSurfacesState {
  // Raw device-reported GetCsCaps version, recorded even when it fails the
  // console's floor check (caps stays null then) so the UI can say why the
  // panel is gated.
  deviceCapsVersion: number | null;
  caps: CsCaps | null;
  nouns: CsNounCaps[];
  bindings: (CsBinding | null)[];   // indexed by slot; null = empty (type NONE)
  names: string[];                  // indexed by slot; slot metadata, independent of the binding
  status: CsStatus | null;
  busy: boolean;
  lastFetchError: string | null;
}

export function createControlSurfacesState(): ControlSurfacesState {
  const s = $state<ControlSurfacesState>({
    deviceCapsVersion: null,
    caps: null,
    nouns: [],
    bindings: Array.from({ length: CS_MAX_BINDINGS }, () => null),
    names: Array.from({ length: CS_MAX_BINDINGS }, () => ''),
    status: null,
    busy: false,
    lastFetchError: null,
  });
  return s;
}
