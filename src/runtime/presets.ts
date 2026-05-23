// Action surface for preset operations. Wraps DspDevice calls

import {
  session,
  refreshSavedFromDraft,
  presets, presetsDirty, askBoundary,
  settings,
} from '@/state';
import { reconcileAfterSync } from './actions';
import { fetchAndApplyAsBaseline } from './resync';
import { flush as flushWrites } from './outbox';
import type { DspDevice } from '@/device/DspDevice';
import { type PresetSlot, PRESET_SLOT_COUNT } from '@/domain';
import { type PresetResult, PresetStartupMode } from '@/protocol';
import { Log, Result } from '@/utils';

const PRESET_LOAD_SETTLE_MS = 100;

export type PresetActionError =
  | { ok: false; code: PresetResult; message?: string }
  | { ok: false; code: 'no-device'; message?: string }
  | { ok: false; code: 'active'; message?: string }
  | { ok: false; code: 'error'; message?: string };

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
// catch. The label is prepended so the user knows which operation failed.
//
// Contract split: Result-returning actions (load/save/paste/delete) report
// failures through their typed Result. The void actions (rename, startup
// default/mode, include-pins) are record-only — they surface failures solely
// via presets.lastActionError (which the UI reads reactively) and do NOT
// rethrow, since their callers await without a catch and a rethrow would only
// leak an unhandled rejection.

function recordActionError(label: string, e: unknown): string {
  const msg = (e as Error)?.message ?? String(e);
  const formatted = `${label}: ${msg}`;
  presets.lastActionError = formatted;
  Log.warn('presets', `${label} failed`, e);
  return formatted;
}

function clearActionError(): void {
  presets.lastActionError = null;
}

function recordToResult(label: string, e: unknown): PresetActionError {
  const message = recordActionError(label, e);
  return { ok: false, code: 'error', message };
}

// Public verb so the UI never writes preset store state directly
// (board review A5 / MOM-2026-05-22). The error-banner dismiss button
// calls this instead of assigning presets.lastActionError = null.
export function dismissPresetActionError(): void {
  clearActionError();
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
      Log.warn('presets', 'directory/active fetch failed', e);
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
        Log.warn('presets', `getPresetName(${i}) failed`, e);
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
      await flushWrites();
      const r = await d.savePreset(active);
      if (r.ok) {
        if (presets.directory) {
          const set = new Set(presets.directory.occupiedSlotsSet);
          set.add(active);
          presets.directory = { ...presets.directory, occupiedSlotsSet: set };
        }
        refreshSavedFromDraft();
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
// Baseline (`dsp.saved`) advances unconditionally: current RAM is what
// we just captured into the slot, and the slot is now active.
export async function savePresetSlot(slot: PresetSlot): Promise<Result<void, PresetResult> | PresetActionError> {
  const d = session.device;
  if (!d) return noDevice();
  clearActionError();
  try {
    return await withBusy(async () => {
      await flushWrites();
      const r = await d.savePreset(slot);
      if (r.ok) {
        if (presets.directory) {
          const set = new Set(presets.directory.occupiedSlotsSet);
          set.add(slot);
          presets.directory = { ...presets.directory, occupiedSlotsSet: set };
        }
        presets.active = slot;
        refreshSavedFromDraft();
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
// to refresh dsp.draft + dsp.saved atomically without flipping
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
      await flushWrites();
      const r = await d.loadPreset(slot);
      if (r.ok) {
        // Reflect active slot in UI immediately. If the subsequent resync or
        // soft-mute reconcile throws, we still want the header/active marker
        // to match the slot the device just loaded.
        presets.active = slot;
        await new Promise<void>((resolve) => setTimeout(resolve, PRESET_LOAD_SETTLE_MS));
        // Atomic: fetch device state and apply to both dsp.draft and
        // dsp.saved in one synchronous statement. Eliminates the
        // microtask window where draft and saved would otherwise disagree
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

// PresetCopy doesn't exist on the wire; PASTE composes a whole-state swap
// using the device's bulk capture/restore so the active-slot pointer never
// changes:
//
//   1. LoadPreset(src)     — RAM = src flash content; device pointer → src
//   2. captureState()      — capture src content as an opaque device blob
//   3. LoadPreset(active)  — restore RAM + device pointer to pre-paste slot
//   4. restoreState(blob)  — push src content into active's RAM (no flash)
//   5. SavePreset(active)  — flash[active] = RAM = src content
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
      await flushWrites();
      // Step 1: Load source into RAM (device pointer → src).
      const r1 = await d.loadPreset(src);
      if (!r1.ok) {
        recordActionError('Paste', new Error(r1.message ?? `error ${r1.code}`));
        return r1;
      }
      // Step 2: Capture src content as a blob.
      const sourceBlob = await d.captureState();
      // Step 3: Restore active slot in RAM (device pointer → active).
      const r3 = await d.loadPreset(active);
      if (!r3.ok) {
        recordActionError('Paste', new Error(r3.message ?? `error ${r3.code}`));
        return r3;
      }
      // Step 4: Push src content into active's RAM (no flash; pointer unchanged).
      await d.restoreState(sourceBlob);
      // Step 5: Flash active slot = RAM = src content.
      const r5 = await d.savePreset(active);
      if (!r5.ok) {
        recordActionError('Paste', new Error(r5.message ?? `error ${r5.code}`));
        return r5;
      }
      if (presets.directory) {
        const set = new Set(presets.directory.occupiedSlotsSet);
        set.add(active);
        presets.directory = { ...presets.directory, occupiedSlotsSet: set };
      }
      presets.active = active;
      await new Promise<void>((resolve) => setTimeout(resolve, PRESET_LOAD_SETTLE_MS));
      // Atomic baseline apply
      await fetchAndApplyAsBaseline();
      await reconcileAfterSync();
      return r5;
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
export async function renamePresetSlot(
  slot: PresetSlot, name: string,
): Promise<Result<void, PresetResult> | PresetActionError> {
  const d = session.device;
  if (!d) return noDevice();
  clearActionError();
  try {
    return await withBusy(async () => {
      await d.setPresetName(slot, name);
      const next = [...presets.names];
      next[slot] = name;
      presets.names = next;
      return Result.ok();
    });
  } catch (e) {
    return recordToResult('Rename', e);
  }
}

export async function setStartupDefault(
  slot: PresetSlot,
): Promise<Result<void, PresetResult> | PresetActionError> {
  const d = session.device;
  if (!d) return noDevice();
  clearActionError();
  try {
    return await withBusy(async () => {
      await d.setPresetStartup({ mode: PresetStartupMode.Specified, slot });
      if (presets.directory) {
        presets.directory = {
          ...presets.directory,
          startupMode: PresetStartupMode.Specified,
          defaultSlot: slot,
        };
      }
      return Result.ok();
    });
  } catch (e) {
    return recordToResult('Set startup default', e);
  }
}

export async function setStartupMode(
  mode: PresetStartupMode,
): Promise<Result<void, PresetResult> | PresetActionError> {
  const d = session.device;
  if (!d) return noDevice();
  const slot = presets.directory?.defaultSlot ?? (0 as PresetSlot);
  clearActionError();
  try {
    return await withBusy(async () => {
      await d.setPresetStartup({ mode, slot });
      if (presets.directory) {
        presets.directory = { ...presets.directory, startupMode: mode };
      }
      return Result.ok();
    });
  } catch (e) {
    return recordToResult('Set startup mode', e);
  }
}

export async function setPresetIncludePins(
  include: boolean,
): Promise<Result<void, PresetResult> | PresetActionError> {
  const d = session.device;
  if (!d) return noDevice();
  clearActionError();
  try {
    return await withBusy(async () => {
      await d.setPresetIncludePins(include);
      if (presets.directory) {
        presets.directory = { ...presets.directory, includePins: include };
      }
      return Result.ok();
    });
  } catch (e) {
    return recordToResult('Set include pins', e);
  }
}

