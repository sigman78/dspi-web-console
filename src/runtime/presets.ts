// Action surface for preset operations. Wraps DspDevice calls

import { session } from '../state/session.svelte';
import { refreshShadowFromLive } from '../state/dsp.svelte';
import { presets, presetsDirty, askBoundary } from '../state/presets.svelte';
import { settings } from '../state/settings.svelte';
import { reconcileAfterSync } from './actions';
import { fetchAndApplyAsBaseline } from './resync';
import type { DspDevice } from '../device/DspDevice';
import type { PresetSlot } from '../domain/presetLimits';
import { PRESET_SLOT_COUNT } from '../domain/presetLimits';
import type { PresetResult } from '../protocol/results';
import { PresetStartupMode } from '../protocol/wireTypes';
import type { Result } from '../utils/result';
import { warn } from '../utils/log';

const PRESET_LOAD_SETTLE_MS = 100;

export type PresetActionError =
  | { ok: false; code: PresetResult; message?: string }
  | { ok: false; code: 'no-device'; message?: string }
  | { ok: false; code: 'active'; message?: string };

function noDevice(): { ok: false; code: 'no-device'; message: string } {
  return { ok: false, code: 'no-device', message: 'no device' };
}

function activeSlotError(message: string): { ok: false; code: 'active'; message: string } {
  return { ok: false, code: 'active', message };
}

async function withBusy<T>(fn: () => Promise<T>): Promise<T> {
  presets.busy = true;
  try { return await fn(); } finally { presets.busy = false; }
}

// Mutating-action error surfacing. Each mutating action calls
// clearActionError() at the top so a successful retry erases the
// previous error, and recordActionError() on a failure path or in
// catch. The label is prepended so the user knows which operation failed

function recordActionError(label: string, e: unknown): void {
  const msg = (e as Error)?.message ?? String(e);
  presets.lastActionError = `${label}: ${msg}`;
  warn('presets', `${label} failed`, e);
}

function clearActionError(): void {
  presets.lastActionError = null;
}

// Eager + lazy entry point. Idempotent when the cache is populated.
// Never throws — errors are captured in presets.lastFetchError so the
// UI can surface them with a retry button.
export async function fetchPresetInfo(): Promise<void> {
  if (presets.directory != null) return;
  const d = session.device;
  if (!d) return;
  presets.busy = true;
  try {
    // Step 1: directory + active. If either throws we can't show the grid
    // meaningfully, so capture the error and stop.
    let dir: Awaited<ReturnType<typeof d.getPresetDirectory>>;
    let active: Awaited<ReturnType<typeof d.getActivePreset>>;
    try {
      [dir, active] = await Promise.all([d.getPresetDirectory(), d.getActivePreset()]);
    } catch (e) {
      const msg = (e as Error)?.message ?? String(e);
      presets.lastFetchError = `Directory fetch failed: ${msg}`;
      warn('presets', 'directory/active fetch failed', e);
      return;
    }
    presets.directory = dir;
    presets.active = active;
    presets.lastFetchError = null;

    // Step 2: names. Each one is independent — a single bad slot shouldn't
    // hide the whole grid. Failing names land as '' (renders as [unnamed]
    // in the UI).
    const names: string[] = Array.from({ length: PRESET_SLOT_COUNT }, () => '');
    for (let i = 0; i < PRESET_SLOT_COUNT; i++) {
      try {
        names[i] = await d.getPresetName(i as PresetSlot);
      } catch (e) {
        warn('presets', `getPresetName(${i}) failed`, e);
      }
    }
    presets.names = names;
  } finally {
    presets.busy = false;
  }
}

// Clears the cache + error and refetches from scratch.
export async function retryFetchPresetInfo(): Promise<void> {
  presets.directory      = null;
  presets.names          = Array.from({ length: PRESET_SLOT_COUNT }, () => null);
  presets.active         = null;
  presets.lastFetchError = null;
  await fetchPresetInfo();
}

export function invalidatePresetCache(): void {
  presets.directory       = null;
  presets.names           = Array.from({ length: PRESET_SLOT_COUNT }, () => null);
  presets.active          = null;
  presets.lastFetchError  = null;
  presets.lastActionError = null;
}

// PresetSave(active). RAM didn't change → just advance the baseline so
// the dirty diff origin moves.
export async function saveActivePreset(): Promise<Result<void, PresetResult> | PresetActionError> {
  const d = session.device;
  if (!d) return noDevice();
  const active = presets.active;
  if (active == null) return activeSlotError('no active slot');
  clearActionError();
  try {
    return await withBusy(async () => {
      const r = await d.savePreset(active);
      if (r.ok) {
        if (presets.directory) {
          const set = new Set(presets.directory.occupiedSlotsSet);
          set.add(active);
          presets.directory = { ...presets.directory, occupiedSlotsSet: set };
        }
        refreshShadowFromLive();
      } else {
        recordActionError('Save', new Error(r.message ?? `error ${r.code}`));
      }
      return r;
    });
  } catch (e) {
    recordActionError('Save', e);
    throw e;
  }
}

// PresetSave(N) for an arbitrary slot. Mirrors firmware behavior
// PresetSave sets `lastActive = slot`, so the  just-saved slot becomes active
// The host updates `presets.active` to match
//
// Baseline (`dsp.shadow`) advances unconditionally: current RAM is what
// we just captured into the slot, and the slot is now active.
export async function savePresetSlot(slot: PresetSlot): Promise<Result<void, PresetResult> | PresetActionError> {
  const d = session.device;
  if (!d) return noDevice();
  clearActionError();
  try {
    return await withBusy(async () => {
      const r = await d.savePreset(slot);
      if (r.ok) {
        if (presets.directory) {
          const set = new Set(presets.directory.occupiedSlotsSet);
          set.add(slot);
          presets.directory = { ...presets.directory, occupiedSlotsSet: set };
        }
        presets.active = slot;
        refreshShadowFromLive();
      } else {
        recordActionError('Save', new Error(r.message ?? `error ${r.code}`));
      }
      return r;
    });
  } catch (e) {
    recordActionError('Save', e);
    throw e;
  }
}

// PresetLoad(N). Awaits the firmware's deferred flash to RAM copy ~100 ms 
// We then use fetchAndApplyAsBaseline() rather than fullSync()
// to refresh dsp.live + dsp.shadow atomically without flipping 
// session.status to 'connecting' — that toggle would
// cause App.svelte to unmount the entire main view and flash the
// ConnectingHero splash mid-operation. reconcileAfterSync() is still
// required to re-apply soft-mute over the freshly-loaded master volume.
// Internal: wire-level load + post-load epilogue. No dirty gating.
// Called by both loadPresetSlot (after gating) and revertActivePreset
async function executeLoad(
  d: DspDevice,
  slot: PresetSlot,
): Promise<Result<void, PresetResult> | PresetActionError> {
  clearActionError();
  try {
    return await withBusy(async () => {
      const r = await d.loadPreset(slot);
      if (r.ok) {
        // Reflect active slot in UI immediately. If the subsequent resync or
        // soft-mute reconcile throws, we still want the header/active marker
        // to match the slot the device just loaded.
        presets.active = slot;
        await new Promise<void>((resolve) => setTimeout(resolve, PRESET_LOAD_SETTLE_MS));
        // Atomic: fetch device state and apply to both dsp.live and
        // dsp.shadow in one synchronous statement. Eliminates the
        // microtask window where live and shadow would otherwise disagree
        await fetchAndApplyAsBaseline();
        await reconcileAfterSync();
      } else {
        recordActionError('Load', new Error(r.message ?? `error ${r.code}`));
      }
      return r;
    });
  } catch (e) {
    recordActionError('Load', e);
    throw e;
  }
}

export async function loadPresetSlot(slot: PresetSlot): Promise<Result<void, PresetResult> | PresetActionError> {
  const d = session.device;
  if (!d) return noDevice();

  // Dirty-RAM gating. Modal fires only when:
  //   - RAM is dirty AND
  //   - warnOnPresetSwitchDirty is on AND
  //   - the active slot exists (no slot to save into otherwise).
  if (settings.warnOnPresetSwitchDirty && presetsDirty.current && presets.active != null) {
    const choice = await askBoundary({
      title: 'Unsaved changes',
      message: 'You have unsaved changes in the active preset. Switching to another preset will discard them.',
      saveLabel: 'Save & switch',
    });
    if (choice === 'cancel') {
      return { ok: false, code: 'active', message: 'cancelled' };
    }
    if (choice === 'save') {
      const r = await saveActivePreset();
      if (!('ok' in r) || !r.ok) return r as Result<void, PresetResult> | PresetActionError;
    }
    // 'discard' falls through — proceed to load.
  }

  return executeLoad(d, slot);
}

// PresetLoad(active) > used by the Revert button. Bypasses the dirty-gating
// modal because the user explicitly chose to discard their changes by hitting
// Revert; no further confirmation is needed.
export async function revertActivePreset(): Promise<Result<void, PresetResult> | PresetActionError> {
  const d = session.device;
  if (!d) return noDevice();
  const active = presets.active;
  if (active == null) return activeSlotError('no active slot');
  return executeLoad(d, active);
}

// PresetCopy doesn't exist on the wire; PASTE composes:
//   LoadPreset(src) - RAM = src's flash content
//   SavePreset(active) - flash[active] = RAM = src content
//   LoadPreset(active) - RAM = active = src content
//
// End state: active slot holds source's content, RAM matches, active
// unchanged. The COPY/PASTE invariant in the UI guarantees clean RAM
// here (copy source clears on dirty), so we don't gate via boundary
// modal - any caller violating the invariant gets stale-source
// behaviour, not data loss.
export async function pastePresetTo(src: PresetSlot): Promise<Result<void, PresetResult> | PresetActionError> {
  const d = session.device;
  if (!d) return noDevice();
  const active = presets.active;
  if (active == null) return activeSlotError('no active slot');
  if (active === src) return activeSlotError('source and target are the same');
  clearActionError();
  try {
    return await withBusy(async () => {
      // 1. Load source into RAM
      const r1 = await d.loadPreset(src);
      if (!r1.ok) {
        recordActionError('Paste', new Error(r1.message ?? `error ${r1.code}`));
        return r1;
      }
      // 2. Save RAM into active
      const r2 = await d.savePreset(active);
      if (!r2.ok) {
        recordActionError('Paste', new Error(r2.message ?? `error ${r2.code}`));
        return r2;
      }
      if (presets.directory) {
        const set = new Set(presets.directory.occupiedSlotsSet);
        set.add(active);
        presets.directory = { ...presets.directory, occupiedSlotsSet: set };
      }
      // 3. Reload active to sync host caches and ensure RAM == active.
      const r3 = await d.loadPreset(active);
      if (!r3.ok) {
        recordActionError('Paste', new Error(r3.message ?? `error ${r3.code}`));
        return r3;
      }
      presets.active = active;
      await new Promise<void>((resolve) => setTimeout(resolve, PRESET_LOAD_SETTLE_MS));
      // Atomic baseline apply
      await fetchAndApplyAsBaseline();
      await reconcileAfterSync();
      return r3;
    });
  } catch (e) {
    recordActionError('Paste', e);
    throw e;
  }
}

// PresetDelete(N). Host-side guard: refuses to delete the active slot.
export async function deletePresetSlot(slot: PresetSlot): Promise<Result<void, PresetResult> | PresetActionError> {
  const d = session.device;
  if (!d) return noDevice();
  if (presets.active === slot) {
    return activeSlotError('cannot delete active slot');
  }
  clearActionError();
  try {
    return await withBusy(async () => {
      const r = await d.deletePreset(slot);
      if (r.ok && presets.directory) {
        const set = new Set(presets.directory.occupiedSlotsSet);
        set.delete(slot);
        presets.directory = { ...presets.directory, occupiedSlotsSet: set };
      } else if (!r.ok) {
        recordActionError('Delete', new Error(r.message ?? `error ${r.code}`));
      }
      return r;
    });
  } catch (e) {
    recordActionError('Delete', e);
    throw e;
  }
}

// PresetSetName(N). Slot names live in the directory and persist through
// PresetDelete, so the rename is independent of slot occupancy. Channel
// names (which DO live in the payload) flow through actions.ts; this
// function is only for the slot-level name.
export async function renamePresetSlot(slot: PresetSlot, name: string): Promise<void> {
  const d = session.device;
  if (!d) return;
  clearActionError();
  try {
    await withBusy(async () => {
      await d.setPresetName(slot, name);
      const next = [...presets.names];
      next[slot] = name;
      presets.names = next;
    });
  } catch (e) {
    recordActionError('Rename', e);
    throw e;
  }
}

export async function setStartupDefault(slot: PresetSlot): Promise<void> {
  const d = session.device;
  if (!d) return;
  clearActionError();
  try {
    await withBusy(async () => {
      await d.setPresetStartup({ mode: PresetStartupMode.Specified, slot });
      if (presets.directory) {
        presets.directory = {
          ...presets.directory,
          startupMode: PresetStartupMode.Specified,
          defaultSlot: slot,
        };
      }
    });
  } catch (e) {
    recordActionError('Set startup default', e);
    throw e;
  }
}

export async function setStartupMode(mode: PresetStartupMode): Promise<void> {
  const d = session.device;
  if (!d) return;
  const slot = presets.directory?.defaultSlot ?? (0 as PresetSlot);
  clearActionError();
  try {
    await withBusy(async () => {
      await d.setPresetStartup({ mode, slot });
      if (presets.directory) {
        presets.directory = { ...presets.directory, startupMode: mode };
      }
    });
  } catch (e) {
    recordActionError('Set startup mode', e);
    throw e;
  }
}

