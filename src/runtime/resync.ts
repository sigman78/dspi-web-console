import type { ReadySession } from '@/state';
import { Log } from '@/utils';

// Sole entry point left here after the D3 recovery-stack consolidation:
// failure recovery (write/scrub/probe) no longer forces its own bulk re-fetch
// on throw -- it calls `mirror.requestReconcile(true)` and heals through the
// background param cadence (src/runtime/poll.ts) on its next eligible tick.
// This function remains because baseline semantics (mirror.init, draft+saved
// together) are specific to preset transitions and don't fit that cadence.

// Fetch device state and apply it as a fresh baseline (draft + saved together,
// atomically). Use for preset transitions (Load / Paste / Revert) where there
// is no meaningful "dirty" state: the atomic apply avoids the microtask window
// where draft and saved disagree and observers see a spurious dirty flip.
export async function fetchAndApplyAsBaseline(s: ReadySession): Promise<void> {
  try {
    const snap = await s.queue.run(() => s.device.getSnapshot());
    s.mirror.init(snap);
    s.health.noteOk();
  } catch (err) {
    s.health.noteFail('resync', err);
    Log.warn('resync', 'baseline re-fetch failed', err);
    throw err;
  }
}
