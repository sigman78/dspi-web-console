// Reactive store for the preset UI. Holds the cached directory packet,
// per-slot names, the active slot, and an in-flight `busy` flag. The
// dirty flag is *not* a stored field — `presetsDirty.current` computes
// the diff on read.

import {
  type PresetSlot, PRESET_SLOT_COUNT,
  type PresetDirectoryInfo,
  MasterVolumeMode,
  diffSnapshots, type SnapshotChange,
} from '@/domain';
import { mirror, presetBaseline } from './mirror.svelte';
import { settings } from './settings.svelte';
import { activeSession } from './appState.svelte';

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

// Inert fallback so component reads while disconnected get null/default values. A
// stale in-flight fetchPresetInfo write can land here after disconnect; harmless,
// since it is never read while a session is active and the next connect gets a fresh store.
const detached = createPresetsState();

function pst(): PresetsState {
  return activeSession()?.presets ?? detached;
}

// Transparent forwarder over the active session's preset store. Transitional
// scaffolding: runtime/presets.ts and the preset components keep using the
// `presets` global unchanged; they migrate to session.presets in a later phase,
// after which this bag (and the flat shape) gives way to the loading|ready|error
// union. resetPresets/presetsDirty below read/write through this forwarder.
export const presets = {
  get directory() { return pst().directory; }, set directory(v: PresetsState['directory']) { pst().directory = v; },
  get names() { return pst().names; }, set names(v: PresetsState['names']) { pst().names = v; },
  get active() { return pst().active; }, set active(v: PresetsState['active']) { pst().active = v; },
  get busy() { return pst().busy; }, set busy(v: boolean) { pst().busy = v; },
  get lastFetchError() { return pst().lastFetchError; }, set lastFetchError(v: string | null) { pst().lastFetchError = v; },
  get lastActionError() { return pst().lastActionError; }, set lastActionError(v: string | null) { pst().lastActionError = v; },
  get savedMasterVolumeDb() { return pst().savedMasterVolumeDb; }, set savedMasterVolumeDb(v: number | null) { pst().savedMasterVolumeDb = v; },
};

// Device-reported kinds that change without a user edit; never count as dirty.
const RUNTIME_CHANGE_KINDS = new Set<SnapshotChange['kind']>(['lgSoundSyncStatus']);

// Re-evaluates on every read inside a tracking context. The diff is
// O(channels × bands) ≈ 132 ops — cheap enough to run per read. The change-set
// is empty in the common (clean) case, so .some() short-circuits immediately.
export const presetsDirty = {
  get current(): boolean {
    if (!mirror.current || !presetBaseline.current) return false;
    const ignoreVol = (presets.directory?.masterVolumeMode ?? MasterVolumeMode.Independent) === MasterVolumeMode.Independent;
    const soft = settings.soft.muted;
    // Pins ride the preset only when includePins is set; otherwise a pin change
    // isn't preset content and must not mark dirty. Unknown directory ⇒ excluded.
    const includePins = presets.directory?.includePins === true;
    return diffSnapshots(presetBaseline.current, mirror.current).some((c) =>
      !RUNTIME_CHANGE_KINDS.has(c.kind) &&
      !(c.kind === 'masterVolume' && (ignoreVol || soft)) &&
      !(c.kind === 'outputPins' && !includePins));
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
