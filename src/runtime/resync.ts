import { fromBulkParams } from '../domain/bulkToSnapshot';
import { createHardwareProfile } from '../domain/hardware';
import { session } from '../state/session.svelte';
import { applyDspSnapshot, dsp } from '../state/dsp.svelte';
import { warn } from '../utils/log';
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
    const hardware = session.hardware
      ?? createHardwareProfile(dsp.live?.platform.type ?? bulk.platformId);
    session.hardware = hardware;
    applyDspSnapshot(fromBulkParams(hardware, bulk));
  } catch (err) {
    warn('resync', 'bulk re-fetch failed', err);
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
