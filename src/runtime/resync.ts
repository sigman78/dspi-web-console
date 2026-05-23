import { session, applyDraftSnapshot, dsp } from '@/state';
import { Log } from '@/utils';
import { makeResyncScheduler } from './schedulers';
import { applyBaselineConverged } from './outbox';

const RESYNC_MS = 250;

async function fetchAndApply(force: boolean): Promise<void> {
  const d = session.device;
  if (!d) return;
  // Soft-skip if any optimistic write is in flight; forceResyncNow()
  // bypasses for failure recovery.
  if (!force && dsp.pendingWrites.size > 0) return;
  try {
    const snap = await d.getSnapshot();
    if (!force && dsp.pendingWrites.size > 0) return;
    // Draft-only: the preset-dirty diff measures against `dsp.saved`,
    // which must NOT auto-update on every resync. Callers that need to
    // re-baseline saved (Preset Load/Revert) call refreshSavedFromDraft
    // after awaiting forceResyncNow().
    applyDraftSnapshot(snap);
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

// Fetch device state and apply it as a fresh baseline (draft + saved together,
// atomically). Use for preset transitions (Load / Paste / Revert) where there
// is no meaningful "dirty" state: the atomic apply avoids the microtask window
// where draft and saved disagree and observers see a spurious dirty flip.
// Cancels any pending trailing resync so a delayed draft-only fetch can't
// later overwrite saved. See docs/ARCH.md for the baseline/draft split.
export async function fetchAndApplyAsBaseline(): Promise<void> {
  scheduler.cancel();
  const d = session.device;
  if (!d) return;
  try {
    const snap = await d.getSnapshot();
    applyBaselineConverged(snap);
  } catch (err) {
    Log.warn('resync', 'baseline re-fetch failed', err);
  }
}
