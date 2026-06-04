// Reactive store for the preset UI. Holds the cached directory packet,
// per-slot names, the active slot, and an in-flight `busy` flag. The
// dirty flag is *not* a stored field — `presetsDirty(s)` computes
// the diff on read.

import {
  type PresetSlot, PRESET_SLOT_COUNT,
  type PresetDirectoryInfo,
  MasterVolumeMode,
  diffSnapshots, type SnapshotChange,
} from '@/domain';
import { settings } from './settings.svelte';
import type { ReadySession } from './appState.svelte';

export interface PresetsState {
  directory: PresetDirectoryInfo | null;
  names:     (string | null)[];
  active:    PresetSlot | null;
  busy:      boolean;
  // Surfaces the last fetch failure for UI display. Null when last fetch
  // succeeded or has not run. The UI shows this above the slot grid when
  // present so real-firmware oddities aren't invisible.
  lastFetchError: string | null;
  // Surfaces the last mutating-action failure (save/load/rename/delete/
  // startup). Distinct from lastFetchError so a stale rename failure
  // doesn't hide a directory-refetch error and vice-versa. Cleared at the
  // start of each mutating action and on cache invalidation.
  lastActionError: string | null;
  // The device's saved boot-baseline master volume (0xD7), fetched alongside
  // the directory. Null until fetched / when no device. Drives the Save button's
  // dirty state: it's enabled unless the live volume provably equals this.
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

// Device-reported kinds that change without a user edit; never count as dirty.
const RUNTIME_CHANGE_KINDS = new Set<SnapshotChange['kind']>(['lgSoundSyncStatus']);

// Re-evaluates on every read inside a tracking context. The diff is
// O(channels × bands) ≈ 132 ops — cheap enough to run per read. The change-set
// is empty in the common (clean) case, so .some() short-circuits immediately.
export function presetsDirty(s: ReadySession): boolean {
  const m = s.mirror;
  if (!m.current || !m.baseline) return false;
  const ignoreVol = (s.presets.directory?.masterVolumeMode ?? MasterVolumeMode.Independent) === MasterVolumeMode.Independent;
  const soft = settings.soft.muted;
  // Pins ride the preset only when includePins is set; otherwise a pin change
  // isn't preset content and must not mark dirty. Unknown directory ⇒ excluded.
  const includePins = s.presets.directory?.includePins === true;
  return diffSnapshots(m.baseline, m.current).some((c) =>
    !RUNTIME_CHANGE_KINDS.has(c.kind) &&
    !(c.kind === 'masterVolume' && (ignoreVol || soft)) &&
    !(c.kind === 'outputPins' && !includePins));
}

// Clears any pending boundary modal so test runs don't carry state. Each
// installed session gets a fresh PresetsState, so there are no forwarder
// fields to reset here.
export function resetBoundary(): void {
  boundary.pending = null;
  pendingResolve = null;
}

// ---------------------------------------------------------------------------
// Boundary modal state — one-promise-at-a-time pattern.
// A component awaits askBoundary(); the modal renders while pending != null;
// the user's choice resolves the promise via resolveBoundary(choice).
// ---------------------------------------------------------------------------

export type BoundaryChoice = 'save' | 'discard' | 'cancel';

export interface BoundaryPrompt {
  title: string;
  message: string;
  saveLabel: string; // e.g. "Save and continue", "Save and disconnect"
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
