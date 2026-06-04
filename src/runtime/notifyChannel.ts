import { parseNotifyPacket, isReconcileTrigger, isPresetOpEcho, ParamSource, type NotifyEvent } from '@/protocol';
import { applyParamChange } from './notifyApply';
import { pushNotice, type ReadySession } from '@/state';
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
export function startNotifyChannel(session: ReadySession, clock: LoopClock = timerClock(NOTIFY_INTERVAL_MS)): Disposer {
  const device = session.device;
  const mir = session.mirror;
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
    const seq = 'seq' in event ? event.seq : null;
    if (seq !== null) {
      // A gap means a possibly-external event was missed — always re-read,
      // even under a preset guard (the guard only knows about its own echoes).
      if (lastSeq !== null && ((lastSeq + 1) & 0xff) !== seq) mir.requestReconcile(true);
      lastSeq = seq;
    }
    // Confirm a preset load (user- or externally-triggered) via a toast. The
    // device notification is the authority that the slot actually loaded.
    if (event.kind === 'presetLoaded') {
      const name = session.presets.names[event.slot] ?? '';
      pushNotice('info', name ? `Loaded preset "${name}"` : `Loaded preset ${String(event.slot).padStart(2, '0')}`);
    }
    // A non-HOST PARAM_CHANGED is applied precisely and locally (Layer 2); only
    // if the apply declines do we fall back to a full reconcile. HOST echoes fall
    // through to isReconcileTrigger below, which drops them.
    if (event.kind === 'paramChanged' && event.source !== ParamSource.Host) {
      if (!applyParamChange(device, mir, event)) mir.requestReconcile(true);
      return;
    }
    // Suppress ONLY the full-reconcile backstop echoes (preset/bulk) of our own
    // in-flight preset op. Bulk/preset/seq-gap still reconcile.
    if (isReconcileTrigger(event) && !(mir.presetGuardActive() && isPresetOpEcho(event))) {
      mir.requestReconcile(true);
    }
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
