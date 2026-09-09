// Reactive store for the V16 Control Surfaces feature (0x84-0x87): caps
// tables, per-slot bindings, and live status. Not part of the bulk packet --
// fetched once at connect via its own vendor commands (see
// runtime/deviceService.ts), like ctrlIfaces.

import {
  CS_MAX_BINDINGS, CS_MAX_IR_COMMANDS, CS_MAX_GROUPS, CS_MAX_MACROS, CS_MAX_DISPLAY_PAGES,
  type CsBinding, type CsCaps, type CsNounCaps, type CsStatus, type CsIrCommand,
  type CsGroup, type CsExtStatus, type CsMacro,
  type CsDisplayLimits, type CsDisplayCfg, type CsDisplayPage, type CsDisplayStatus,
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
  // display cfg/pages/status (caps v10+); null limits = no display support.
  displayLimits: CsDisplayLimits | null;
  displayCfg: CsDisplayCfg | null;
  displayPages: (CsDisplayPage | null)[];
  displayStatus: CsDisplayStatus | null;
  // Bumped after a successful csRevertConfig so every CS panel drops its
  // local drafts -- the GROUPS panel has no parent to receive a reset prop.
  revertEpoch: number;
  // Unapplied local edits per CS editor panel (each panel publishes its own
  // count). Read by the CONTROL tab's CHANGES panel: staged edits are not
  // part of a device SAVE until applied.
  staged: CsStagedCounts;
  busy: boolean;
  lastFetchError: string | null;
}

export interface CsStagedCounts {
  bindings: number;
  groups: number;
  macros: number;
  display: number;
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
    displayLimits: null,
    displayCfg: null,
    displayPages: Array.from({ length: CS_MAX_DISPLAY_PAGES }, () => null),
    displayStatus: null,
    revertEpoch: 0,
    staged: { bindings: 0, groups: 0, macros: 0, display: 0 },
    busy: false,
    lastFetchError: null,
  });
  return s;
}
