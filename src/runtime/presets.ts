// Action surface for preset operations. Wraps DspDevice calls

import {
  presetsDirty, askBoundary,
  settings,
  type ReadySession, type PresetsState,
} from '@/state';
import { reconcileAfterSync } from './actionsDevice';
import { fetchAndApplyAsBaseline } from './resync';
import { flushAllWrites as flushWrites } from './writes';
import { acceptsWriteFormat } from '@/device/capabilities';
import { type PresetSlot, PRESET_SLOT_COUNT } from '@/domain';
import { type PresetResult, PresetStartupMode } from '@/protocol';
import { Log, Result } from '@/utils';

const PRESET_LOAD_SETTLE_MS = 100;

// A console-initiated preset op (Load / Paste / Revert) re-fetches device truth
// itself (fetchAndApplyAsBaseline). The firmware emits bulk/preset notifications
// for that same op — some trailing past the action's return — which the
// NotifyChannel would otherwise reconcile redundantly. Hold the suppression
// guard across the op plus this grace so the late echoes are absorbed too. Sized
// to comfortably cover a few notify read cycles (cadence ~150 ms).
const PRESET_ECHO_GRACE_MS = 500;

// loadPreset only acks the command; the firmware copies flash→RAM asynchronously
// in its main loop (~100 ms). Wait this out before reading or overwriting RAM.
function settleAfterLoad(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, PRESET_LOAD_SETTLE_MS));
}

export type PresetActionError =
  | { ok: false; code: PresetResult; message?: string }
  | { ok: false; code: 'no-device'; message?: string }
  | { ok: false; code: 'active'; message?: string }
  | { ok: false; code: 'error'; message?: string };

function activeSlotError(message: string): { ok: false; code: 'active'; message: string } {
  return { ok: false, code: 'active', message };
}

async function withBusy<T>(ps: PresetsState, fn: () => Promise<T>): Promise<T> {
  ps.busy = true;
  try { return await fn(); } finally { ps.busy = false; }
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

function recordActionError(ps: PresetsState, label: string, e: unknown): string {
  const msg = (e as Error)?.message ?? String(e);
  const formatted = `${label}: ${msg}`;
  ps.lastActionError = formatted;
  Log.warn('presets', `${label} failed`, e);
  return formatted;
}

function clearActionError(ps: PresetsState): void {
  ps.lastActionError = null;
}

function recordToResult(ps: PresetsState, label: string, e: unknown): PresetActionError {
  const message = recordActionError(ps, label, e);
  return { ok: false, code: 'error', message };
}

// Public verb so the UI never writes preset store state directly: the
// error-banner dismiss button calls this instead of assigning lastActionError.
export function dismissPresetActionError(s: ReadySession): void {
  clearActionError(s.presets);
}

// Eager + lazy entry point. Idempotent when the cache is populated.
// Never throws — errors are captured in presets.lastFetchError so the
// UI can surface them with a retry button.
export async function fetchPresetInfo(s: ReadySession): Promise<void> {
  if (s.presets.directory != null) return;
  const d = s.device;
  s.presets.busy = true;
  try {
    // Step 1: directory + active. If either throws we can't show the grid
    // meaningfully, so capture the error and stop.
    let dir: Awaited<ReturnType<typeof d.getPresetDirectory>>;
    let active: Awaited<ReturnType<typeof d.getActivePreset>>;
    try {
      [dir, active] = await Promise.all([d.getPresetDirectory(), d.getActivePreset()]);
    } catch (e) {
      const msg = (e as Error)?.message ?? String(e);
      s.presets.lastFetchError = `Directory fetch failed: ${msg}`;
      Log.warn('presets', 'directory/active fetch failed', e);
      return;
    }
    s.presets.directory = dir;
    s.presets.active = active;
    s.presets.lastFetchError = null;

    // Boot-baseline master volume (independent of the directory packet).
    // Best-effort: a failure here must not hide the slot grid.
    try {
      s.presets.savedMasterVolumeDb = await d.getSavedMasterVolume();
    } catch (e) {
      Log.warn('presets', 'getSavedMasterVolume failed', e);
    }

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
    s.presets.names = names;
  } finally {
    s.presets.busy = false;
  }
}

// Clears the cache + error and refetches from scratch.
export async function retryFetchPresetInfo(s: ReadySession): Promise<void> {
  s.presets.directory           = null;
  s.presets.names               = Array.from({ length: PRESET_SLOT_COUNT }, () => null);
  s.presets.active              = null;
  s.presets.lastFetchError      = null;
  s.presets.savedMasterVolumeDb = null;
  await fetchPresetInfo(s);
}

export function invalidatePresetCache(s: ReadySession): void {
  s.presets.directory           = null;
  s.presets.names               = Array.from({ length: PRESET_SLOT_COUNT }, () => null);
  s.presets.active              = null;
  s.presets.lastFetchError      = null;
  s.presets.lastActionError     = null;
  s.presets.savedMasterVolumeDb = null;
}

// PresetSave(active). RAM didn't change → just advance the baseline so
// the dirty diff origin moves.
export async function saveActivePreset(s: ReadySession): Promise<Result<void, PresetResult> | PresetActionError> {
  const d = s.device;
  const active = s.presets.active;
  if (active == null) return activeSlotError('no active slot');
  clearActionError(s.presets);
  try {
    return await withBusy(s.presets, async () => {
      await flushWrites(s);
      const r = await d.savePreset(active);
      if (r.ok) {
        if (s.presets.directory) {
          const set = new Set(s.presets.directory.occupiedSlotsSet);
          set.add(active);
          s.presets.directory = { ...s.presets.directory, occupiedSlotsSet: set };
        }
        s.mirror.captureBaseline();
      } else {
        recordActionError(s.presets, 'Save', new Error(r.message ?? `error ${r.code}`));
      }
      return r;
    });
  } catch (e) {
    recordActionError(s.presets, 'Save', e);
    throw e;
  }
}

// PresetSave(N) for an arbitrary slot. Firmware sets lastActive = slot, so the
// just-saved slot becomes active; the host mirrors that into presets.active and
// advances the baseline (RAM is what we just captured into the now-active slot).
export async function savePresetSlot(s: ReadySession, slot: PresetSlot): Promise<Result<void, PresetResult> | PresetActionError> {
  const d = s.device;
  clearActionError(s.presets);
  try {
    return await withBusy(s.presets, async () => {
      await flushWrites(s);
      const r = await d.savePreset(slot);
      if (r.ok) {
        if (s.presets.directory) {
          const set = new Set(s.presets.directory.occupiedSlotsSet);
          set.add(slot);
          s.presets.directory = { ...s.presets.directory, occupiedSlotsSet: set };
        }
        s.presets.active = slot;
        s.mirror.captureBaseline();
      } else {
        recordActionError(s.presets, 'Save', new Error(r.message ?? `error ${r.code}`));
      }
      return r;
    });
  } catch (e) {
    recordActionError(s.presets, 'Save', e);
    throw e;
  }
}

// Wire-level load + post-load epilogue, no dirty gating. Called by
// loadPresetSlot (after gating) and revertActivePreset. Uses
// fetchAndApplyAsBaseline (not fullSync) so session.status never flips to
// 'connecting' — that would unmount the main view and flash the splash
// mid-load. reconcileAfterSync re-applies soft-mute over the loaded volume.
async function executeLoad(
  s: ReadySession,
  slot: PresetSlot,
): Promise<Result<void, PresetResult> | PresetActionError> {
  const d = s.device;
  clearActionError(s.presets);
  // Suppress the NotifyChannel's redundant reconciles for this self-induced op;
  // our own fetchAndApplyAsBaseline below is the authoritative resync.
  const mir = s.mirror;
  mir.beginPresetGuard();
  try {
    return await withBusy(s.presets, async () => {
      await flushWrites(s);
      const r = await d.loadPreset(slot);
      if (r.ok) {
        // Reflect active slot in UI immediately. If the subsequent resync or
        // soft-mute reconcile throws, we still want the header/active marker
        // to match the slot the device just loaded.
        s.presets.active = slot;
        await settleAfterLoad();
        await fetchAndApplyAsBaseline();
        await reconcileAfterSync();
      } else {
        recordActionError(s.presets, 'Load', new Error(r.message ?? `error ${r.code}`));
      }
      return r;
    });
  } catch (e) {
    recordActionError(s.presets, 'Load', e);
    throw e;
  } finally {
    mir.endPresetGuard(PRESET_ECHO_GRACE_MS);
  }
}

export async function loadPresetSlot(s: ReadySession, slot: PresetSlot): Promise<Result<void, PresetResult> | PresetActionError> {
  // Dirty-RAM gating. Modal fires only when:
  //   - RAM is dirty AND
  //   - warnOnPresetSwitchDirty is on AND
  //   - the active slot exists (no slot to save into otherwise).
  if (settings.warnOnPresetSwitchDirty && presetsDirty(s) && s.presets.active != null) {
    const choice = await askBoundary({
      title: 'Unsaved changes',
      message: 'You have unsaved changes in the active preset. Switching to another preset will discard them.',
      saveLabel: 'Save & switch',
    });
    if (choice === 'cancel') {
      return { ok: false, code: 'active', message: 'cancelled' };
    }
    if (choice === 'save') {
      const r = await saveActivePreset(s);
      if (!('ok' in r) || !r.ok) return r as Result<void, PresetResult> | PresetActionError;
    }
    // 'discard' falls through — proceed to load.
  }

  return executeLoad(s, slot);
}

// PresetLoad(active) > used by the Revert button. Bypasses the dirty-gating
// modal because the user explicitly chose to discard their changes by hitting
// Revert; no further confirmation is needed.
export async function revertActivePreset(s: ReadySession): Promise<Result<void, PresetResult> | PresetActionError> {
  const active = s.presets.active;
  if (active == null) return activeSlotError('no active slot');
  return executeLoad(s, active);
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
// End state: active slot holds source's content, RAM matches, active unchanged.
// The UI's copy/paste invariant guarantees clean RAM here (copy source clears
// on dirty), so there's no boundary-modal gate; a violating caller gets
// stale-source behaviour, not data loss.
export async function pastePresetTo(s: ReadySession, src: PresetSlot): Promise<Result<void, PresetResult> | PresetActionError> {
  const d = s.device;
  const active = s.presets.active;
  if (active == null) return activeSlotError('no active slot');
  if (active === src) return activeSlotError('source and target are the same');
  clearActionError(s.presets);
  // Paste runs three loads + a save, each emitting source=preset notifications;
  // suppress those self-echoes — step-8's fetchAndApplyAsBaseline is the resync.
  const mir = s.mirror;
  mir.beginPresetGuard();
  try {
    return await withBusy(s.presets, async () => {
      await flushWrites(s);
      // Step 1: Load source into RAM (device pointer → src).
      const r1 = await d.loadPreset(src);
      if (!r1.ok) {
        recordActionError(s.presets, 'Paste', new Error(r1.message ?? `error ${r1.code}`));
        return r1;
      }
      // Step 2: Capture src content as a blob — only after the load has settled
      // into RAM, else we'd capture the previous (active) slot's content.
      await settleAfterLoad();
      const sourceBlob = await d.captureState();
      // Step 3: Restore active slot in RAM (device pointer → active).
      const r3 = await d.loadPreset(active);
      if (!r3.ok) {
        recordActionError(s.presets, 'Paste', new Error(r3.message ?? `error ${r3.code}`));
        return r3;
      }
      // Step 4: Push src content into active's RAM (no flash; pointer unchanged).
      // Wait for the active-slot load to settle first, otherwise its deferred
      // flash→RAM copy could land after restoreState and clobber the source.
      await settleAfterLoad();
      // Write gate
      if (!acceptsWriteFormat(d.capabilities, sourceBlob.formatVersion)) {
        const msg = `Paste blocked: snapshot format v${sourceBlob.formatVersion} cannot be written to device wire v${d.capabilities.wire}`;
        recordActionError(s.presets, 'Paste', new Error(msg));
        return { ok: false, code: 'error', message: msg };
      }
      await d.restoreState(sourceBlob);
      // Step 5: Flash active slot = RAM = src content.
      const r5 = await d.savePreset(active);
      if (!r5.ok) {
        recordActionError(s.presets, 'Paste', new Error(r5.message ?? `error ${r5.code}`));
        return r5;
      }
      if (s.presets.directory) {
        const set = new Set(s.presets.directory.occupiedSlotsSet);
        set.add(active);
        s.presets.directory = { ...s.presets.directory, occupiedSlotsSet: set };
      }
      s.presets.active = active;
      await settleAfterLoad();
      await fetchAndApplyAsBaseline();
      await reconcileAfterSync();
      return r5;
    });
  } catch (e) {
    recordActionError(s.presets, 'Paste', e);
    throw e;
  } finally {
    mir.endPresetGuard(PRESET_ECHO_GRACE_MS);
  }
}

// PresetDelete(N). Host-side guard: refuses to delete the active slot.
export async function deletePresetSlot(s: ReadySession, slot: PresetSlot): Promise<Result<void, PresetResult> | PresetActionError> {
  const d = s.device;
  if (s.presets.active === slot) {
    return activeSlotError('cannot delete active slot');
  }
  clearActionError(s.presets);
  try {
    return await withBusy(s.presets, async () => {
      const r = await d.deletePreset(slot);
      if (r.ok && s.presets.directory) {
        const set = new Set(s.presets.directory.occupiedSlotsSet);
        set.delete(slot);
        s.presets.directory = { ...s.presets.directory, occupiedSlotsSet: set };
      } else if (!r.ok) {
        recordActionError(s.presets, 'Delete', new Error(r.message ?? `error ${r.code}`));
      }
      return r;
    });
  } catch (e) {
    recordActionError(s.presets, 'Delete', e);
    throw e;
  }
}

// PresetSetName(N). Slot names live in the directory and persist through
// PresetDelete, so the rename is independent of slot occupancy. Channel
// names (which DO live in the payload) flow through actions.ts; this
// function is only for the slot-level name.
export async function renamePresetSlot(
  s: ReadySession, slot: PresetSlot, name: string,
): Promise<Result<void, PresetResult> | PresetActionError> {
  const d = s.device;
  clearActionError(s.presets);
  try {
    return await withBusy(s.presets, async () => {
      await d.setPresetName(slot, name);
      const next = [...s.presets.names];
      next[slot] = name;
      s.presets.names = next;
      return Result.ok();
    });
  } catch (e) {
    return recordToResult(s.presets, 'Rename', e);
  }
}

export async function setStartupDefault(
  s: ReadySession, slot: PresetSlot,
): Promise<Result<void, PresetResult> | PresetActionError> {
  const d = s.device;
  clearActionError(s.presets);
  try {
    return await withBusy(s.presets, async () => {
      await d.setPresetStartup({ mode: PresetStartupMode.Specified, slot });
      if (s.presets.directory) {
        s.presets.directory = {
          ...s.presets.directory,
          startupMode: PresetStartupMode.Specified,
          defaultSlot: slot,
        };
      }
      return Result.ok();
    });
  } catch (e) {
    return recordToResult(s.presets, 'Set startup default', e);
  }
}

export async function setStartupMode(
  s: ReadySession, mode: PresetStartupMode,
): Promise<Result<void, PresetResult> | PresetActionError> {
  const d = s.device;
  const slot = s.presets.directory?.defaultSlot ?? (0 as PresetSlot);
  clearActionError(s.presets);
  try {
    return await withBusy(s.presets, async () => {
      await d.setPresetStartup({ mode, slot });
      if (s.presets.directory) {
        s.presets.directory = { ...s.presets.directory, startupMode: mode };
      }
      return Result.ok();
    });
  } catch (e) {
    return recordToResult(s.presets, 'Set startup mode', e);
  }
}

export async function setPresetIncludePins(
  s: ReadySession, include: boolean,
): Promise<Result<void, PresetResult> | PresetActionError> {
  const d = s.device;
  clearActionError(s.presets);
  try {
    return await withBusy(s.presets, async () => {
      await d.setPresetIncludePins(include);
      if (s.presets.directory) {
        s.presets.directory = { ...s.presets.directory, includePins: include };
      }
      return Result.ok();
    });
  } catch (e) {
    return recordToResult(s.presets, 'Set include pins', e);
  }
}
