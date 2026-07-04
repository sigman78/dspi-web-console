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

// Pump fast while an action awaits a specific event via the waiter registry --
// the endpoint usually has a stale IDLE armed, so an event needs ~2 reads.
const NOTIFY_BURST_MS = 8;

// The firmware ring (usb_audio.c) accumulates notify events while EP 0x83
// goes unread -- e.g. a bench/HIL session that loads dozens of presets with
// no host connected. A device that somehow never idles (ring wedged, or
// pushing events faster than we drain) must not mute the channel forever, so
// the backlog drain gives up after this many non-idle reads and goes live
// anyway. The real firmware ring is smaller than this.
const NOTIFY_BACKLOG_DRAIN_CAP = 64;

// Start the notify read loop for a device. Returns a stop disposer.
export function startNotifyChannel(session: ReadySession, clock: LoopClock = timerClock(NOTIFY_INTERVAL_MS)): Disposer {
  const device = session.device;
  const mir = session.mirror;

  let stopped = false;
  let lastSeq: number | null = null;
  let backoffMs = 0;   // 0 = normal cadence; grows on consecutive read errors

  // Backlog drain: the connect flow fetches its baseline snapshot before this
  // channel starts, so anything sitting in the ring at that point is strictly
  // history. Stay muted (no toast, no notifyWaiters, no reconcile) until the
  // first idle keep-alive proves the ring is empty -- the firmware only arms
  // idle when it has nothing queued, so that read is an exact "backlog fully
  // drained" boundary.
  let backlogMode = true;
  let backlogDrained = 0;   // non-idle backlog reads seen so far; see NOTIFY_BACKLOG_DRAIN_CAP
  const isHidden = () => typeof document !== 'undefined' && document.hidden;
  let offVisibility: Disposer = () => {};

  function teardown(): void {
    stopped = true;
    clock.cancel();
    offVisibility();
    session.notifyWaiters.setKick(null);
  }

  function handle(event: NotifyEvent): void {
    session.notifyWaiters.notify(event);   // observe-only; routing below is unchanged
    const seq = 'seq' in event ? event.seq : null;
    if (seq !== null) {
      // A gap means a possibly-external event was missed -- always re-read, even
      // under a preset guard (the guard only knows about its own echoes).
      if (lastSeq !== null && ((lastSeq + 1) & 0xff) !== seq) mir.requestReconcile(true);
      lastSeq = seq;
    }
    // The device notification is the authority that the slot actually loaded.
    if (event.kind === 'presetLoaded') {
      const name = session.presets.names[event.slot] ?? '';
      pushNotice('info', name ? `Loaded preset "${name}"` : `Loaded preset ${String(event.slot).padStart(2, '0')}`);
    }
    // Non-HOST PARAM_CHANGED is applied locally; only if the apply declines do we
    // fall back to a full reconcile. HOST echoes fall through to isReconcileTrigger
    // below, which drops them.
    if (event.kind === 'paramChanged' && event.source !== ParamSource.Host) {
      if (!applyParamChange(session, event)) mir.requestReconcile(true);
      return;
    }
    // Suppress ONLY the full-reconcile backstop echoes of our own in-flight preset
    // op. Bulk/preset/seq-gap still reconcile.
    if (isReconcileTrigger(event) && !(mir.presetGuardActive() && isPresetOpEcho(event))) {
      mir.requestReconcile(true);
    }
  }

  async function pump(): Promise<void> {
    if (stopped) return;
    try {
      const bytes = await device.readNotification();
      if (bytes === null) {
        // No notify endpoint: reads will always be null. Stop rather than spin a
        // no-op loop forever.
        Log.warn('notify', 'transport exposes no notify endpoint; stopping channel');
        teardown();
        return;
      }
      backoffMs = 0;   // healthy read -> normal cadence
      if (bytes.byteLength > 0) {
        const event = parseNotifyPacket(bytes);
        if (backlogMode) {
          if (event.kind === 'idle') {
            backlogMode = false;   // ring drained: everything from here is live
          } else {
            // Replay of history, not news -- drop it, but prime seq
            // continuity so the first LIVE event isn't misread as a gap.
            if ('seq' in event) lastSeq = event.seq;
            if (++backlogDrained >= NOTIFY_BACKLOG_DRAIN_CAP) {
              Log.warn('notify', 'backlog drain cap exceeded; going live without an idle boundary');
              backlogMode = false;
            }
          }
        } else {
          handle(event);
        }
      }
    } catch (e) {
      session.health.noteFail('notify', e);
      backoffMs = backoffMs === 0
        ? NOTIFY_INTERVAL_MS * 2
        : Math.min(backoffMs * 2, NOTIFY_MAX_BACKOFF_MS);
      Log.warn('notify', 'read failed; backing off', e);
    }
    if (!stopped && !isHidden()) {
      // Errors always win (backoff a wedged endpoint); backlog drain reads as
      // fast as possible so the toast storm doesn't linger at the normal
      // 150ms cadence; otherwise the existing burst/default cadence applies.
      const delay = backoffMs || (backlogMode ? 0 : (session.notifyWaiters.pending() ? NOTIFY_BURST_MS : undefined));
      clock.next(pump, delay);
    }
  }

  offVisibility = subscribeVisibility(
    () => clock.next(pump),   // shown: resume (poll.ts owns the resume reconcile)
    () => clock.cancel(),
  );

  session.notifyWaiters.setKick(() => clock.next(pump, 0));

  if (!isHidden()) clock.next(pump);

  return teardown;
}
