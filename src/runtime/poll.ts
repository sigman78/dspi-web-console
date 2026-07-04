import type { ReadySession } from '@/state';
import { Log, timerClock, subscribeVisibility, type LoopClock, type Disposer } from '@/utils';
import type { DspDevice } from '@/device/DspDevice';
import { ALL_CHANNELS, AudioInputSource, wireChannelFor } from '@/domain';

const STATUS_INTERVAL_MS = 50;   // ~20 Hz -- peaks + cpu
const BUFFER_INTERVAL_MS = 250;  // ~4 Hz  -- buffer stats
const INFO_INTERVAL_MS = 1000;   // ~1 Hz  -- env scalars + counters
const SPDIF_RX_INTERVAL_MS = 1000;  // ~1 Hz  -- S/PDIF RX status (SPDIF input only)
const PARAM_INTERVAL_MS = 3000;  // ~0.3 Hz -- background param-mirror reconcile floor
// Unconditional re-fetch floor, independent of any pending reconcile request.
// Notify is the primary sync trigger, but firmware 1.1.4 has verified coverage
// holes: the UAC1 OS volume slider does not emit PARAM_CHANGED
// (`audio_set_volume` skips `param_write`), and GPIO sources aren't
// implemented yet. This is what heals that drift -- do not remove it when
// notify coverage improves without re-checking those holes.
const PARAM_SAFETY_NET_MS = 10_000;

interface Cadence {
  key: 'status' | 'buffer' | 'info' | 'spdifRx' | 'param';
  intervalMs: number;
  runWhileHidden: boolean;          // today all false (pause everything when hidden)
  lastMs(): number;                 // cadence clock -- reads the STORE timestamp
  run(d: DspDevice): Promise<void>; // owns its own timestamp update
  // Optional override of the default interval gate. Returns true when the
  // cadence should run this tick. Used by the param reconcile cadence, which
  // gates on in-flight writes and a pending reconcile request, not just time.
  shouldRun?(now: number): boolean;
}

export function startPolling(session: ReadySession, clock: LoopClock = timerClock(STATUS_INTERVAL_MS)): Disposer {
  const tele = session.telemetry;
  const mir = session.mirror;
  const health = session.health;
  let stopped = false;
  const isHidden = () => typeof document !== 'undefined' && document.hidden;
  // Only the in-flight guards are loop-local. The cadence CLOCK stays on the
  // telemetry store (tele.applyPeaks sets lastStatusMs and reads it for peak
  // decay), so the gate must read the store, not a private copy.
  const inFlight: Record<Cadence['key'], boolean> = { status: false, buffer: false, info: false, spdifRx: false, param: false };

  async function pollStatus(d: DspDevice): Promise<void> {
    try {
      // Priority: the 20 Hz status cadence must not stall behind a queued
      // snapshot fetch.
      const s = await session.queue.run(() => d.getSystemStatus(), { priority: true });
      // Status peaks/clip bits are wire-channel indexed; the telemetry store is
      // domain-ChannelId indexed. Identity on V10, shifted on V16 RP2350.
      const hw = d.hardware;
      const peaks: number[] = Array(ALL_CHANNELS.length).fill(0);
      let clipFlags = 0;
      for (const ch of hw.channels) {
        const wire = wireChannelFor(hw, ch.id);
        peaks[ch.id] = s.peaks[wire] ?? 0;
        if (s.isClipping(wire)) clipFlags |= 1 << ch.id;
      }
      tele.applyPeaks(peaks, performance.now());   // sets tele.lastStatusMs
      tele.applyClipFlags(clipFlags);
      tele.activeInputChannels = s.activeInputChannels;
      tele.cpu0 = s.cpu0;
      tele.cpu1 = s.cpu1;
      tele.errorCount = 0;
      health.noteOk();
    } catch (e) {
      tele.errorCount++;
      health.noteFail('poll:status', e);
      if (tele.errorCount <= 3) Log.warn('poll', 'getSystemStatus failed', e);
    }
  }

  async function pollBuffer(d: DspDevice): Promise<void> {
    try {
      const b = await session.queue.run(() => d.getBufferStats());
      if (b) {
        tele.bufferStats = b;
        tele.streaming = b.streaming;
        tele.pdmActive = b.pdmActive;
        tele.sequence = b.sequence;
      }
      health.noteOk();
      tele.lastBufferMs = performance.now();
    } catch (e) {
      health.noteFail('poll:buffer', e);
      Log.warn('poll', 'getBufferStats failed', e);
      tele.lastBufferMs = performance.now();
    }
  }

  async function pollInfo(d: DspDevice): Promise<void> {
    try {
      tele.applyPartialInfo(await session.queue.run(() => d.getSystemInfo()));   // sets tele.lastInfoMs
      health.noteOk();
    } catch (e) {
      health.noteFail('poll:info', e);
      Log.warn('poll', 'getSystemInfo failed', e);
      tele.lastInfoMs = performance.now();
    }
  }

  // S/PDIF RX live status. Only runs when the snapshot shows SPDIF input source
  // (the opcode is valid on USB input too, but the data is stale/zeroed there).
  // lastSpdifRxMs is tracked locally (not on the telemetry store) because no
  // other subsystem needs to read it.
  let lastSpdifRxMs = 0;
  async function pollSpdifRx(d: DspDevice): Promise<void> {
    try {
      tele.spdifRxStatus = await session.queue.run(() => d.getSpdifRxStatus());
      health.noteOk();
    } catch (e) {
      health.noteFail('poll:spdifRx', e);
      Log.warn('poll', 'getSpdifRxStatus failed', e);
    } finally {
      lastSpdifRxMs = performance.now();
    }
  }

  function shouldRunSpdifRx(now: number): boolean {
    if (mir.current?.inputConfig.source !== AudioInputSource.Spdif) return false;
    return now - lastSpdifRxMs >= SPDIF_RX_INTERVAL_MS;
  }

  // Background param-mirror reconcile. shouldRunParam already decided this tick
  // is eligible; we fetch, then re-check before applying. The CommandQueue makes
  // the fetch atomic with respect to any write already registered when it was
  // enqueued -- no send can interleave mid-fetch -- but a scrub mutates the
  // mirror optimistically at schedule time, before its send is even queued, so a
  // drag that starts after this fetch was enqueued can still race ahead of the
  // snapshot landing. Re-checking `writes.busy` after the await catches that
  // case: discard rather than clobber, leaving the request pending (no mid-drag
  // clobber). The request is consumed only on a successful, still-valid apply: a
  // fetch failure or a newly-busy session keep it pending for the next eligible
  // tick. replaceCurrent (not init) keeps presetBaseline pinned.
  async function pollParam(d: DspDevice): Promise<void> {
    try {
      const snap = await session.queue.run(() => d.getSnapshot());
      if (session.writes.busy) return;
      mir.replaceCurrent(snap);
      mir.consumeReconcile();
      health.noteOk();
    } catch (e) {
      health.noteFail('poll:param', e);
      Log.warn('poll', 'param reconcile failed', e);  // request stays pending
    } finally {
      tele.lastParamMs = performance.now();
    }
  }

  // Run when a reconcile is pending and no write is registered-unsettled or lane
  // active. writes.busy is exact (no quiet-window guess needed): every device
  // control call funnels through the session's CommandQueue, so a fetch can
  // never interleave with a send. Then either eager, or the floor interval
  // elapsed. Peek (not consume) so a skipped tick leaves the request pending.
  // With nothing pending, fall through to the unconditional safety net
  // (PARAM_SAFETY_NET_MS) -- gated on the preset guard too, so it can't land a
  // redundant fetch mid preset-op (that flow already re-syncs itself via
  // fetchAndApplyAsBaseline).
  function shouldRunParam(now: number): boolean {
    // Degraded: the probe owns recovery. Without this gate a pending eager
    // request would drive a bulk fetch into the dead link every ctrl-timeout
    // (~2 s), each one failing -- the exact pile-up the write-path suppression
    // exists to prevent. On recovery the probe clears degraded and re-arms an
    // eager request, so healing resumes on the next tick.
    if (health.degraded) return false;
    if (session.writes.busy) return false;
    if (mir.presetGuardActive(now)) return false;
    const { wanted, eager } = mir.peekReconcile();
    if (wanted) {
      // lastParamMs === 0 means we've never reconciled this session: the first
      // pending request is eligible immediately rather than waiting a full
      // floor interval after connect.
      return eager || tele.lastParamMs === 0 || now - tele.lastParamMs >= PARAM_INTERVAL_MS;
    }
    return now - tele.lastParamMs >= PARAM_SAFETY_NET_MS;
  }

  const cadences: Cadence[] = [
    { key: 'status',  intervalMs: STATUS_INTERVAL_MS,   runWhileHidden: false, lastMs: () => tele.lastStatusMs, run: pollStatus },
    { key: 'buffer',  intervalMs: BUFFER_INTERVAL_MS,   runWhileHidden: false, lastMs: () => tele.lastBufferMs, run: pollBuffer },
    { key: 'info',    intervalMs: INFO_INTERVAL_MS,     runWhileHidden: false, lastMs: () => tele.lastInfoMs,   run: pollInfo },
    { key: 'spdifRx', intervalMs: SPDIF_RX_INTERVAL_MS, runWhileHidden: false, lastMs: () => lastSpdifRxMs,     run: pollSpdifRx, shouldRun: shouldRunSpdifRx },
    { key: 'param',   intervalMs: PARAM_INTERVAL_MS,    runWhileHidden: false, lastMs: () => tele.lastParamMs,  run: pollParam, shouldRun: shouldRunParam },
  ];
  const anyRunWhileHidden = cadences.some((c) => c.runWhileHidden);

  async function doPoll(): Promise<void> {
    if (stopped || !session.alive) return;
    const d = session.device;
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
    if (isHidden() && !anyRunWhileHidden) return;   // hidden -> stop ticking (zero wakeups)
    clock.next(tick);                                // re-arm first; doPoll is fire-and-forget
    void doPoll();
  };

  // Removed by stop(), so it never fires after dispose -- no `stopped` guard.
  const offVisibility = subscribeVisibility(
    () => {                        // tab shown
      mir.requestReconcile(true);  // repaint to truth after a blind period
      clock.next(tick);
    },
    () => { if (!anyRunWhileHidden) clock.cancel(); },
  );

  tele.errorCount = 0;
  if (!(isHidden() && !anyRunWhileHidden)) clock.next(tick);

  const stop = () => {
    stopped = true;
    clock.cancel();
    offVisibility();
  };
  return stop;
}
