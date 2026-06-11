// Reactive store for the preset UI. The dirty flag is not stored --
// `presetsDirty(s)` computes the diff on read.

import {
  type PresetSlot, PRESET_SLOT_COUNT,
  type PresetDirectoryInfo,
  MasterVolumeMode, OutputConfigMode,
  diffSnapshots,
  CHANGE_CLASS,
} from '@/domain';
import type { ReadySession } from './appState.svelte';

export interface PresetsState {
  directory: PresetDirectoryInfo | null;
  names:     (string | null)[];
  active:    PresetSlot | null;
  busy:      boolean;
  // Last directory-fetch failure, surfaced above the slot grid; null on success.
  lastFetchError: string | null;
  // Last mutating-action failure (save/load/rename/delete/startup). Kept distinct
  // from lastFetchError so neither hides the other; cleared at the start of each
  // mutating action and on cache invalidation.
  lastActionError: string | null;
  // The device's saved boot-baseline master volume (0xD7), fetched alongside the
  // directory. Drives the Save button: enabled unless live volume provably equals it.
  savedMasterVolumeDb: number | null;
}

export function createPresetsState(): PresetsState {
  const s = $state<PresetsState>({
    directory:       null,
    names:           Array.from({ length: PRESET_SLOT_COUNT }, () => null),
    active:          null,
    busy:            false,
    lastFetchError:  null,
    lastActionError: null,
    savedMasterVolumeDb: null,
  });
  return s;
}

// Re-evaluates on every read in a tracking context. The diff is ~132 ops, cheap
// enough per read; the change-set is empty in the clean case.
export function presetsDirty(s: ReadySession): boolean {
  const m = s.mirror;
  if (!m.current || !m.baseline) return false;
  const ignoreVol = (s.presets.directory?.masterVolumeMode ?? MasterVolumeMode.Independent) === MasterVolumeMode.Independent;
  // The physical-IO block rides the preset only in WithPreset mode; unknown
  // directory => excluded (mode unknown until the directory is fetched).
  const withPresetIo = s.presets.directory?.outputConfigMode === OutputConfigMode.WithPreset;
  return diffSnapshots(m.baseline, m.current).some((c): boolean => {
    switch (CHANGE_CLASS[c.kind]) {
      case 'runtime-status': return false;
      case 'volume':         return !ignoreVol;
      case 'output-config':  return withPresetIo;
      case 'preset-content': return true;
    }
  });
}

// Clears any pending boundary modal so test runs don't carry state.
export function resetBoundary(): void {
  boundary.pending = null;
  pendingResolve = null;
}

// Boundary modal, one-promise-at-a-time: a component awaits askBoundary(); the
// modal renders while pending != null; the user's choice resolves the promise.
export type BoundaryChoice = 'save' | 'discard' | 'cancel';

export interface BoundaryPrompt {
  title: string;
  message: string;
  saveLabel?: string;    // e.g. "Save & switch"; omitted = no save option (discard/cancel only)
  discardLabel?: string; // defaults to "Switch anyway"
}

interface BoundaryState {
  pending: BoundaryPrompt | null;
}

export const boundary = $state<BoundaryState>({ pending: null });

let pendingResolve: ((choice: BoundaryChoice) => void) | null = null;

export function askBoundary(prompt: BoundaryPrompt): Promise<BoundaryChoice> {
  if (boundary.pending !== null) {
    return Promise.reject(new Error('a boundary modal is already pending'));
  }
  boundary.pending = prompt;
  return new Promise<BoundaryChoice>((resolve) => {
    pendingResolve = resolve;
  });
}

export function resolveBoundary(choice: BoundaryChoice): void {
  const r = pendingResolve;
  pendingResolve = null;
  boundary.pending = null;
  r?.(choice);
}
