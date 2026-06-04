import { activeSession } from '@/state';
import { Log } from '@/utils';

// Forced bulk re-fetch + current-only apply. Used by failure recovery after
// a write throws. Current-only because the preset-dirty diff measures against
// `presetBaseline`, which must NOT drift on every resync; callers that need to
// re-baseline (Preset Load / Revert) use fetchAndApplyAsBaseline.
export async function forceResyncNow(): Promise<void> {
  const s = activeSession();
  if (!s) return;
  try {
    const snap = await s.device.getSnapshot();
    s.mirror.replaceCurrent(snap);
  } catch (err) {
    Log.warn('resync', 'bulk re-fetch failed', err);
  }
}

// Fetch device state and apply it as a fresh baseline (draft + saved together,
// atomically). Use for preset transitions (Load / Paste / Revert) where there
// is no meaningful "dirty" state: the atomic apply avoids the microtask window
// where draft and saved disagree and observers see a spurious dirty flip.
// See docs/ARCH.md for the baseline/draft split.
export async function fetchAndApplyAsBaseline(): Promise<void> {
  const s = activeSession();
  if (!s) return;
  try {
    const snap = await s.device.getSnapshot();
    s.mirror.init(snap);
  } catch (err) {
    Log.warn('resync', 'baseline re-fetch failed', err);
  }
}
