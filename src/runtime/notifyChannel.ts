import type { DspDevice } from '@/device/DspDevice';
import { parseNotifyPacket, isReconcileTrigger, type NotifyEvent } from '@/protocol';
import { requestReconcile } from '@/state/mirror.svelte';
import { Log } from '@/utils';

// Default poll cadence: loose enough that idle cost is a few 64-byte reads/sec,
// tight enough for prompt reflection of sparse events.
const NOTIFY_INTERVAL_MS = 150;

// Minimal injectable clock (mirrors poll.ts PollClock) so tests drive the loop
// deterministically. next() MUST be idempotent: calling it while a callback is
// already scheduled cancels the prior and arms a fresh one (no double-fire).
export interface NotifyClock {
  next(cb: () => void): void;
  cancel(): void;
}

export const notifyTimerClock = (ms = NOTIFY_INTERVAL_MS): NotifyClock => {
  let id: ReturnType<typeof setTimeout> | null = null;
  return {
    next: (cb) => { if (id != null) clearTimeout(id); id = setTimeout(cb, ms); },
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
      if (bytes && bytes.byteLength > 0) handle(parseNotifyPacket(bytes));
    } catch (e) {
      Log.warn('notify', 'read failed', e);
    }
    if (!stopped && !isHidden()) clock.next(pump);
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
