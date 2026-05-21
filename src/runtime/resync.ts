import { fromBulkParams } from '@/domain';
import { session, applyDspSnapshot, applyLiveSnapshot, dsp } from '@/state';
import { Log } from '@/utils';
import { makeResyncScheduler } from './schedulers';

const RESYNC_MS = 250;

async function fetchAndApply(force: boolean): Promise<void> {
  const d = session.device;
  if (!d) return;
  // Soft-skip if any optimistic write is in flight; forceResyncNow()
  // bypasses for failure recovery.
  if (!force && dsp.pendingWrites.size > 0) return;
  try {
    const bulk = await d.getAllParams();
    if (!force && dsp.pendingWrites.size > 0) return;
    const hardware = d.hardware;
    session.hardware = hardware;
    // Live-only: the preset-dirty diff measures against `dsp.shadow`,
    // which must NOT auto-update on every resync. Callers that need to
    // re-baseline shadow (Preset Load/Revert) call refreshShadowFromLive
    // after awaiting forceResyncNow().
    applyLiveSnapshot(fromBulkParams(hardware, bulk));
  } catch (err) {
    Log.warn('resync', 'bulk re-fetch failed', err);
  }
}

const scheduler = makeResyncScheduler(() => fetchAndApply(false), RESYNC_MS);

// Trailing-edge re-fetch + apply, used after a successful coalesced write.
export function scheduleResync(): void {
  scheduler.schedule();
}

// Cancel any pending re-fetch (e.g. on disconnect).
export function cancelResync(): void {
  scheduler.cancel();
}

// Cancel any pending timer and run a re-fetch immediately. Used after a failed write to confirm device truth ASAP.
export async function forceResyncNow(): Promise<void> {
  scheduler.cancel();
  await fetchAndApply(true);
}

// Fetch the device state and apply it as a fresh baseline — both `dsp.live`
// and `dsp.shadow` update in one synchronous statement via applyDspSnapshot.
//
// Use this for preset transitions (Load / Paste / Revert) where there is
// no meaningful "dirty" state during the operation. The atomic apply
// eliminates the microtask window where live and shadow would otherwise
// disagree, so observers watching `presetsDirty.current` (e.g. the
// copy-source auto-clear $effect in PresetsTab) don't see a spurious flip.
//
// Cancels any pending trailing resync so a delayed live-only fetch can't
// fire later and partially overwrite shadow.
//
// See docs/ARCH-TRANSACT.md for the bug class this prevents.
export async function fetchAndApplyAsBaseline(): Promise<void> {
  scheduler.cancel();
  const d = session.device;
  if (!d) return;
  try {
    const bulk = await d.getAllParams();
    const hardware = d.hardware;
    session.hardware = hardware;
    applyDspSnapshot(fromBulkParams(hardware, bulk), bulk);
  } catch (err) {
    Log.warn('resync', 'baseline re-fetch failed', err);
  }
}
