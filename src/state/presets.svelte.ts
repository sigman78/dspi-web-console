// Reactive store for the preset UI. Holds the cached directory packet,
// per-slot names, the active slot, and an in-flight `busy` flag. The
// dirty flag is *not* a stored field — `presetsDirty.current` computes
// the diff on read (matches the `isInFlight` pattern in dsp.svelte.ts).
//
// See docs/superpowers/specs/2026-05-10-presets-wire-protocol-plan.md §State runtime.

import {
  type PresetSlot, PRESET_SLOT_COUNT,
  type PresetDirectoryInfo,
  MasterVolumeMode,
  presetDiff,
} from '@/domain';
import { dsp } from './dsp.svelte';
import { settings } from './settings.svelte';

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
  // start of each mutating action and on resetPresets / cache invalidation.
  lastActionError: string | null;
}

export const presets = $state<PresetsState>({
  directory:       null,
  names:           Array.from({ length: PRESET_SLOT_COUNT }, () => null),
  active:          null,
  busy:            false,
  lastFetchError:  null,
  lastActionError: null,
});

// Re-evaluates on every read inside a tracking context. The diff is
// O(channels × bands) ≈ 132 ops — cheap enough to run per read. Caches
// would just add a cache-invalidation problem.
export const presetsDirty = {
  get current(): boolean {
    if (!dsp.live || !dsp.shadow) return false;
    const mode = presets.directory?.masterVolumeMode ?? MasterVolumeMode.Independent;
    return presetDiff(dsp.shadow, dsp.live, {
      ignoreMasterVolume: mode === MasterVolumeMode.Independent,
      softMuted:          settings.soft.muted,
    });
  },
};

export function resetPresets(): void {
  presets.directory       = null;
  presets.names           = Array.from({ length: PRESET_SLOT_COUNT }, () => null);
  presets.active          = null;
  presets.busy            = false;
  presets.lastFetchError  = null;
  presets.lastActionError = null;
  // Clear any pending boundary modal so test runs don't carry state.
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
