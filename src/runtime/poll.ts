import { session, applyClipFlags, applyPeaks, status } from '@/state';
import { Log } from '@/utils';
import type { DspDevice } from '@/device/DspDevice';

const STATUS_INTERVAL_MS = 50;   // ~20 Hz -- peaks + cpu
const BUFFER_INTERVAL_MS = 250;  // ~4 Hz  -- buffer stats
const INFO_INTERVAL_MS = 1000;   // ~1 Hz  -- env scalars + counters

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
  key: 'status' | 'buffer' | 'info';
  intervalMs: number;
  runWhileHidden: boolean;          // today all false (pause everything when hidden)
  lastMs(): number;                 // cadence clock — reads the STORE timestamp
  run(d: DspDevice): Promise<void>; // owns its own timestamp update
}

export function startPolling(clock: PollClock = timerClock(STATUS_INTERVAL_MS)): () => void {
  let stopped = false;
  const isHidden = () => typeof document !== 'undefined' && document.hidden;
  // Only the in-flight guards are loop-local. The cadence CLOCK stays on the
  // status store (status.applyPeaks sets lastStatusMs and reads it for peak
  // decay), so the gate must read the store, not a private copy.
  const inFlight: Record<Cadence['key'], boolean> = { status: false, buffer: false, info: false };

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

  const cadences: Cadence[] = [
    { key: 'status', intervalMs: STATUS_INTERVAL_MS, runWhileHidden: false, lastMs: () => status.lastStatusMs, run: pollStatus },
    { key: 'buffer', intervalMs: BUFFER_INTERVAL_MS, runWhileHidden: false, lastMs: () => status.lastBufferMs, run: pollBuffer },
    { key: 'info',   intervalMs: INFO_INTERVAL_MS,   runWhileHidden: false, lastMs: () => status.lastInfoMs,   run: pollInfo },
  ];
  const anyRunWhileHidden = cadences.some((c) => c.runWhileHidden);

  async function doPoll(): Promise<void> {
    if (stopped) return;
    const d = session.device;
    if (!d) return;
    const now = performance.now();
    for (const c of cadences) {
      if (isHidden() && !c.runWhileHidden) continue;
      if (inFlight[c.key] || now - c.lastMs() < c.intervalMs) continue;
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

  const onVisibility = () => {
    if (stopped) return;
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
