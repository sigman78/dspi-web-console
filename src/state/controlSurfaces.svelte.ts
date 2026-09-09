// Reactive store for the V16 Control Surfaces feature (0x84-0x87): caps
// tables, per-slot bindings, and live status. Not part of the bulk packet --
// fetched once at connect via its own vendor commands (see
// runtime/deviceService.ts), like ctrlIfaces.

import {
  CS_MAX_BINDINGS, CS_MAX_IR_COMMANDS, CS_MAX_GROUPS, CS_MAX_MACROS,
  type CsBinding, type CsCaps, type CsNounCaps, type CsStatus, type CsIrCommand,
  type CsGroup, type CsExtStatus, type CsMacro,
} from '@/domain';

// Learn sub-state, mirroring GetCsStatus.irLearnState / the CsIrLearn(2)
// result read: null while idle (nothing armed yet, or after a cancel).
export interface CsIrLearnState {
  state: number;      // CS_IR_LEARN_*
  protocol: number;
  code: number;
}

export interface ControlSurfacesState {
  // Raw device-reported GetCsCaps version, recorded even when it fails the
  // console's floor check (caps stays null then) so the UI can say why the
  // panel is gated.
  deviceCapsVersion: number | null;
  caps: CsCaps | null;
  nouns: CsNounCaps[];
  bindings: (CsBinding | null)[];   // indexed by slot; null = empty (type NONE)
  names: string[];                  // indexed by slot; slot metadata, independent of the binding
  irCommands: (CsIrCommand | null)[];   // indexed by sub-slot; null = empty (protocol NONE)
  irLearn: CsIrLearnState | null;
  status: CsStatus | null;
  // Target groups and macros (caps v9+); stay all-null on older firmware.
  groups: (CsGroup | null)[];   // indexed by group; null = empty slot
  macros: (CsMacro | null)[];   // indexed by macro; null = empty slot
  extStatus: CsExtStatus | null;
  // Bumped after a successful csRevertConfig so every CS panel drops its
  // local drafts -- the GROUPS panel has no parent to receive a reset prop.
  revertEpoch: number;
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
    irCommands: Array.from({ length: CS_MAX_IR_COMMANDS }, () => null),
    irLearn: null,
    status: null,
    groups: Array.from({ length: CS_MAX_GROUPS }, () => null),
    macros: Array.from({ length: CS_MAX_MACROS }, () => null),
    extStatus: null,
    revertEpoch: 0,
    busy: false,
    lastFetchError: null,
  });
  return s;
}
