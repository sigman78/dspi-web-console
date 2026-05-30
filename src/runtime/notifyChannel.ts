import type { DspDevice } from '@/device/DspDevice';
import { parseNotifyPacket, isReconcileTrigger, type NotifyEvent } from '@/protocol';
import { requestReconcile, presetGuardActive } from '@/state/mirror.svelte';
import { Log, timerClock, subscribeVisibility, type LoopClock, type Disposer } from '@/utils';

// Default poll cadence: loose enough that idle cost is a few 64-byte reads/sec,
// tight enough for prompt reflection of sparse events.
const NOTIFY_INTERVAL_MS = 150;

// On read errors the loop backs off exponentially (from one cadence step up to
// this ceiling) so a wedged or stalled endpoint can't spin a tight retry/log
// storm. A healthy read resets to the normal cadence.
const NOTIFY_MAX_BACKOFF_MS = 5000;

// Start the notify read loop for a device. Returns a stop disposer. No-op (and
// the loop never arms) on devices without the notifications capability.
export function startNotifyChannel(device: DspDevice, clock: LoopClock = timerClock(NOTIFY_INTERVAL_MS)): Disposer {
  if (!device.capabilities.features.notifications) {
    return () => {};
  }

  let stopped = false;
  let lastSeq: number | null = null;
  let backoffMs = 0;   // 0 = normal cadence; grows on consecutive read errors
  const isHidden = () => typeof document !== 'undefined' && document.hidden;
  let offVisibility: Disposer = () => {};

  function teardown(): void {
    stopped = true;
    clock.cancel();
    offVisibility();
  }

  function handle(event: NotifyEvent): void {
    // A console-initiated preset op re-fetches authoritatively and emits its own
    // (source=preset) notifications; suppress those self-echoes. seq is still
    // tracked under the guard so no false gap fires once it releases.
    const suppressed = presetGuardActive();
    const seq = 'seq' in event ? event.seq : null;
    if (seq !== null) {
      if (lastSeq !== null && ((lastSeq + 1) & 0xff) !== seq && !suppressed) {
        requestReconcile(true);   // gap ⇒ we missed an event; re-read truth
      }
      lastSeq = seq;
    }
    if (isReconcileTrigger(event) && !suppressed) requestReconcile(true);
  }

  async function pump(): Promise<void> {
    if (stopped) return;
    try {
      const bytes = await device.readNotification();
      if (bytes === null) {
        // The transport structurally exposes no notify endpoint, so reads will
        // always be null. Stop rather than spin a no-op loop forever.
        Log.warn('notify', 'transport exposes no notify endpoint; stopping channel');
        teardown();
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

  offVisibility = subscribeVisibility(
    () => clock.next(pump),   // shown: resume (poll.ts owns the resume reconcile)
    () => clock.cancel(),     // hidden: pause
  );

  if (!isHidden()) clock.next(pump);

  return teardown;
}
