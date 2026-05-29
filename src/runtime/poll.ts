import { session, applyClipFlags, applyPeaks, status } from '@/state';
import { mirror, isInFlight, peekReconcile, consumeReconcile, lastWriteMs } from '@/state/mirror.svelte';
import { Log } from '@/utils';
import type { DspDevice } from '@/device/DspDevice';

const STATUS_INTERVAL_MS = 50;   // ~20 Hz -- peaks + cpu
const BUFFER_INTERVAL_MS = 250;  // ~4 Hz  -- buffer stats
const INFO_INTERVAL_MS = 1000;   // ~1 Hz  -- env scalars + counters
const PARAM_INTERVAL_MS = 3000;  // ~0.3 Hz -- background param-mirror reconcile floor
// A drag is "active" until writes have been quiet this long. The scrub lane
// coalesces at 16 ms and inflight is 0 in the gaps between coalesced sends, so
// the inflight counter alone can't tell mid-drag from drag-done. 100 ms is
// comfortably above the 16 ms coalesce window and a 60 fps frame, while still
// reconciling promptly after the user lets go.
export const RECONCILE_QUIET_MS = 100;

// Pluggable tick driver. Swap setTimeout↔rAF without touching the loop body.
export interface PollClock { next(cb: () => void): void; cancel(): void; }

export const timerClock = (ms = STATUS_INTERVAL_MS): PollClock => {
  let id: ReturnType<typeof setTimeout> | null = null;
  return {
    // Arms exactly one pending tick (idempotent): cancel any prior tick first so a double-call can't leak a chain.
    next: (cb) => { if (id != null) clearTimeout(id); id = setTimeout(cb, ms); },
    cancel: () => { if (id != null) clearTimeout(id); id = null; },
  };
};

// Available for callers that prefer paint-aligned, hidden-auto-pausing polling.
export const rafClock = (): PollClock => {
  let id: number | null = null;
  return {
    // Arms exactly one pending tick (idempotent): cancel any prior frame first so a double-call can't leak a chain.
    next: (cb) => { if (id != null) cancelAnimationFrame(id); id = requestAnimationFrame(cb); },
    cancel: () => { if (id != null) cancelAnimationFrame(id); id = null; },
  };
};

interface Cadence {
  key: 'status' | 'buffer' | 'info' | 'param';
  intervalMs: number;
  runWhileHidden: boolean;          // today all false (pause everything when hidden)
  lastMs(): number;                 // cadence clock — reads the STORE timestamp
  run(d: DspDevice): Promise<void>; // owns its own timestamp update
  // Optional override of the default interval gate. Returns true when the
  // cadence should run this tick. Used by the param reconcile cadence, which
  // gates on in-flight writes and a pending reconcile request, not just time.
  shouldRun?(now: number): boolean;
}

export function startPolling(clock: PollClock = timerClock(STATUS_INTERVAL_MS)): () => void {
  let stopped = false;
  const isHidden = () => typeof document !== 'undefined' && document.hidden;
  // Only the in-flight guards are loop-local. The cadence CLOCK stays on the
  // status store (status.applyPeaks sets lastStatusMs and reads it for peak
  // decay), so the gate must read the store, not a private copy.
  const inFlight: Record<Cadence['key'], boolean> = { status: false, buffer: false, info: false, param: false };

  async function pollStatus(d: DspDevice): Promise<void> {
    try {
      const s = await d.getSystemStatus();
      applyPeaks(s.peaks, performance.now());   // sets status.lastStatusMs
      applyClipFlags(s.clipFlags);
      status.cpu0 = s.cpu0;
      status.cpu1 = s.cpu1;
      status.errorCount = 0;
    } catch (e) {
      status.errorCount++;
      if (status.errorCount <= 3) Log.warn('poll', 'getSystemStatus failed', e);
    }
  }

  async function pollBuffer(d: DspDevice): Promise<void> {
    try {
      const b = await d.getBufferStats();
      if (b) {
        status.bufferStats = b;
        status.streaming = b.streaming;
        status.pdmActive = b.pdmActive;
        status.sequence = b.sequence;
      }
      status.lastBufferMs = performance.now();
    } catch (e) {
      Log.warn('poll', 'getBufferStats failed', e);
      status.lastBufferMs = performance.now();
    }
  }

  async function pollInfo(d: DspDevice): Promise<void> {
    try {
      status.applyPartialInfo(await d.getSystemInfo());   // sets status.lastInfoMs
    } catch (e) {
      Log.warn('poll', 'getSystemInfo failed', e);
      status.lastInfoMs = performance.now();
    }
  }

  // Background param-mirror reconcile. shouldRunParam already decided this tick
  // is eligible; here we fetch, then re-check before applying. Because
  // getSnapshot is async, a write can land during the fetch — if it does, the
  // snapshot is stale relative to the user's latest optimistic value, so we
  // DISCARD it and leave the request pending (no mid-drag clobber). The request
  // is consumed only on a successful, still-valid apply: a fetch failure or a
  // mid-fetch write both keep it pending so the next eligible tick retries.
  // replaceCurrent (not init) keeps presetBaseline pinned.
  async function pollParam(d: DspDevice): Promise<void> {
    const startedAt = performance.now();
    try {
      const snap = await d.getSnapshot();
      // Re-check the gate across the await: a write during the fetch (inflight,
      // or a fresh write timestamp after we started) means our snapshot is
      // already stale. Drop it; the pending request drives a later retry.
      if (isInFlight.current || lastWriteMs() >= startedAt) return;
      mirror.replaceCurrent(snap);
      consumeReconcile();
    } catch (e) {
      Log.warn('poll', 'param reconcile failed', e);  // request stays pending
    } finally {
      status.lastParamMs = performance.now();
    }
  }

  // Run when a reconcile is pending, no write is in flight, AND writes have been
  // quiet for RECONCILE_QUIET_MS (the inflight counter is 0 in the gaps between
  // coalesced scrub sends, so the quiet window is what actually distinguishes
  // mid-drag from drag-done). Then either eager, or the floor interval elapsed.
  // Peek (not consume) so a skipped tick leaves the request pending.
  function shouldRunParam(now: number): boolean {
    if (isInFlight.current) return false;
    if (now - lastWriteMs() < RECONCILE_QUIET_MS) return false;
    const { wanted, eager } = peekReconcile();
    if (!wanted) return false;
    // lastParamMs === 0 means we've never reconciled this session: the first
    // pending request is eligible immediately rather than waiting a full floor
    // interval after connect.
    return eager || status.lastParamMs === 0 || now - status.lastParamMs >= PARAM_INTERVAL_MS;
  }

  const cadences: Cadence[] = [
    { key: 'status', intervalMs: STATUS_INTERVAL_MS, runWhileHidden: false, lastMs: () => status.lastStatusMs, run: pollStatus },
    { key: 'buffer', intervalMs: BUFFER_INTERVAL_MS, runWhileHidden: false, lastMs: () => status.lastBufferMs, run: pollBuffer },
    { key: 'info',   intervalMs: INFO_INTERVAL_MS,   runWhileHidden: false, lastMs: () => status.lastInfoMs,   run: pollInfo },
    { key: 'param',  intervalMs: PARAM_INTERVAL_MS,  runWhileHidden: false, lastMs: () => status.lastParamMs,  run: pollParam, shouldRun: shouldRunParam },
  ];
  const anyRunWhileHidden = cadences.some((c) => c.runWhileHidden);

  async function doPoll(): Promise<void> {
    if (stopped) return;
    const d = session.device;
    if (!d) return;
    const now = performance.now();
    for (const c of cadences) {
      if (isHidden() && !c.runWhileHidden) continue;
      const blocked = c.shouldRun ? !c.shouldRun(now) : (now - c.lastMs() < c.intervalMs);
      if (inFlight[c.key] || blocked) continue;
      inFlight[c.key] = true;
      try { await c.run(d); } finally { inFlight[c.key] = false; }
    }
  }

  const tick = () => {
    if (stopped) return;
    if (isHidden() && !anyRunWhileHidden) return;   // hidden ⇒ stop ticking (zero wakeups)
    clock.next(tick);                                // re-arm first; doPoll is fire-and-forget
    void doPoll();
  };

  // Registered only while the loop is live and removed by stop(), so it never
  // fires after dispose — no `stopped` guard needed here.
  const onVisibility = () => {
    if (isHidden()) { if (!anyRunWhileHidden) clock.cancel(); }
    else clock.next(tick);                           // resume on show
  };

  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);
  status.errorCount = 0;
  if (!(isHidden() && !anyRunWhileHidden)) clock.next(tick);

  const stop = () => {
    stopped = true;
    clock.cancel();
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
  };
  return stop;
}
