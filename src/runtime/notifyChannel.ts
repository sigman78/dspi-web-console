import type { DspDevice } from '@/device/DspDevice';
import { parseNotifyPacket, isReconcileTrigger, type NotifyEvent } from '@/protocol';
import { requestReconcile } from '@/state/mirror.svelte';
import { Log } from '@/utils';

// Default poll cadence: loose enough that idle cost is a few 64-byte reads/sec,
// tight enough for prompt reflection of sparse events.
const NOTIFY_INTERVAL_MS = 150;

// On read errors the loop backs off exponentially (from one cadence step up to
// this ceiling) so a wedged or stalled endpoint can't spin a tight retry/log
// storm. A healthy read resets to the normal cadence.
const NOTIFY_MAX_BACKOFF_MS = 5000;

// Minimal injectable clock (mirrors poll.ts PollClock) so tests drive the loop
// deterministically. next() MUST be idempotent: calling it while a callback is
// already scheduled cancels the prior and arms a fresh one (no double-fire).
// An optional delayMs overrides the default cadence for that one arm (used for
// error backoff).
export interface NotifyClock {
  next(cb: () => void, delayMs?: number): void;
  cancel(): void;
}

export const notifyTimerClock = (ms = NOTIFY_INTERVAL_MS): NotifyClock => {
  let id: ReturnType<typeof setTimeout> | null = null;
  return {
    next: (cb, delayMs) => { if (id != null) clearTimeout(id); id = setTimeout(cb, delayMs ?? ms); },
    cancel: () => { if (id != null) clearTimeout(id); id = null; },
  };
};

// Start the notify read loop for a device. Returns a stop disposer. No-op (and
// the loop never arms) on devices without the notifications capability.
export function startNotifyChannel(device: DspDevice, clock: NotifyClock = notifyTimerClock()): () => void {
  if (!device.capabilities.features.notifications) {
    return () => {};
  }

  let stopped = false;
  let lastSeq: number | null = null;
  let backoffMs = 0;   // 0 = normal cadence; grows on consecutive read errors
  const isHidden = () => typeof document !== 'undefined' && document.hidden;

  function handle(event: NotifyEvent): void {
    const seq = 'seq' in event ? event.seq : null;
    if (seq !== null) {
      if (lastSeq !== null && ((lastSeq + 1) & 0xff) !== seq) {
        requestReconcile(true);   // gap ⇒ we missed an event; re-read truth
      }
      lastSeq = seq;
    }
    if (isReconcileTrigger(event)) requestReconcile(true);
  }

  async function pump(): Promise<void> {
    if (stopped) return;
    try {
      const bytes = await device.readNotification();
      if (bytes === null) {
        // The transport structurally exposes no notify endpoint, so reads will
        // always be null. Stop rather than spin a no-op loop forever.
        Log.warn('notify', 'transport exposes no notify endpoint; stopping channel');
        stopped = true;
        return;
      }
      backoffMs = 0;   // healthy read ⇒ back to normal cadence
      if (bytes.byteLength > 0) handle(parseNotifyPacket(bytes));
    } catch (e) {
      backoffMs = backoffMs === 0
        ? NOTIFY_INTERVAL_MS * 2
        : Math.min(backoffMs * 2, NOTIFY_MAX_BACKOFF_MS);
      Log.warn('notify', 'read failed; backing off', e);
    }
    if (!stopped && !isHidden()) clock.next(pump, backoffMs || undefined);
  }

  const onVisibility = () => {
    if (stopped) return;
    if (isHidden()) clock.cancel();
    else clock.next(pump);   // resume; poll.ts owns the resume reconcile
  };
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);

  if (!isHidden()) clock.next(pump);

  return () => {
    stopped = true;
    clock.cancel();
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
  };
}
