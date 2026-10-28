import type { ReadySession } from '@/state';
import { Log, timerClock, subscribeVisibility, type LoopClock, type Disposer } from '@/utils';
import type { DspDevice } from '@/device/DspDevice';
import type { DeviceFeatures } from '@/protocol/capabilities';
import * as Domain from '@/domain';
import type { DspSnapshot } from '@/domain';
import { refreshCsDisplayStatus, refreshCsExtStatus } from './controlSurfaceActions';

const STATUS_INTERVAL_MS = 50;   // ~20 Hz -- peaks + cpu
const BUFFER_INTERVAL_MS = 250;  // ~4 Hz  -- buffer stats
const INFO_INTERVAL_MS = 1000;   // ~1 Hz  -- env scalars + counters
const SPDIF_RX_INTERVAL_MS = 1000;  // ~1 Hz  -- S/PDIF RX status (SPDIF input only)
const I2S_SLAVE_INTERVAL_MS = 1000;  // ~1 Hz  -- I2S slave-clock status (slave mode only)
const ADAT_INTERVAL_MS = 1000;   // ~1 Hz  -- ADAT lightpipe output status (enabled only)
const ADAT_INPUT_INTERVAL_MS = 1000;   // ~1 Hz  -- ADAT lightpipe input status (enabled only)
const SUBHARM_INTERVAL_MS = 1000;   // ~1 Hz  -- subharm headroom readout (enabled only)
const SUBHARM_METER_INTERVAL_MS = 200;   // ~5 Hz  -- subharm sub meter (PR.06 panel mounted only)
const LIMITER_METER_INTERVAL_MS = 100;   // 100 ms cadence, ~7 Hz effective -- limiter GR meter (PR.07 panel mounted only)
const LIMITER_STATUS_INTERVAL_MS = 1000;   // ~1 Hz  -- limiter status block, piggybacks the meter tick
const CS_EXT_INTERVAL_MS = 500;   // ~2 Hz  -- CS ext status while a macro runs (MACROS panel mounted only)
const CS_DISPLAY_INTERVAL_MS = 1000;   // ~1 Hz  -- CS display status while a display runs (DISPLAY panel mounted only)
const PARAM_INTERVAL_MS = 3000;  // ~0.3 Hz -- background param-mirror reconcile floor
// Unconditional re-fetch floor, independent of any pending reconcile request.
// Notify is the primary sync trigger, but firmware 1.1.4 has verified coverage
// holes: the UAC1 OS volume slider does not emit PARAM_CHANGED
// (`audio_set_volume` skips `param_write`), and GPIO sources aren't
// implemented yet. This is what heals that drift -- do not remove it when
// notify coverage improves without re-checking those holes.
const PARAM_SAFETY_NET_MS = 10_000;

// Conditions that must all hold for a cadence to be eligible on a tick. Absent
// keys impose nothing.
interface Gates {
  // The device exposes this feature.
  feature?: keyof DeviceFeatures;
  // Persisted intent in the mirror; a missing snapshot keeps the gate shut.
  enabled?: (snap: DspSnapshot) => boolean;
  // Interest or live state held outside the mirror (a mounted panel, a running
  // macro).
  wanted?: () => boolean;
  // Stand down while the link is degraded.
  healthy?: true;
  // Stand down while a write is registered-unsettled.
  idle?: true;
}

interface Cadence {
  key: 'status' | 'buffer' | 'info' | 'spdifRx' | 'i2sSlave' | 'adat' | 'adatInput' | 'subharm' | 'subharmMeter' | 'limiterMeter' | 'csExt' | 'csDisplay' | 'param';
  intervalMs: number;
  runWhileHidden: boolean;          // today all false (pause everything when hidden)
  gates: Gates;
  // Clock owned by the telemetry store, so actions can zero it to force a
  // re-read. Absent: a loop-local clock stamped after every run.
  lastMs?(): number;
  run(d: DspDevice): Promise<void>;
  // Replaces the whole gate-and-interval decision. Only the param reconcile
  // cadence needs it: it gates on pending requests and the preset guard.
  shouldRun?(now: number): boolean;
}

export function startPolling(session: ReadySession, clock: LoopClock = timerClock(STATUS_INTERVAL_MS)): Disposer {
  const tele = session.telemetry;
  const mir = session.mirror;
  const health = session.health;
  const cs = session.controlSurfaces;
  let stopped = false;
  const isHidden = () => typeof document !== 'undefined' && document.hidden;
  const inFlight = new Set<Cadence['key']>();
  const localLast: Partial<Record<Cadence['key'], number>> = {};

  // Link-health convention for telemetry reads: a failure counts against the
  // link (the probe owns recovery) and is logged. The control-surface panel
  // polls instead drop a failed tick silently (refreshCsExtStatus).
  async function guardedRead(key: string, what: string, read: () => Promise<void>): Promise<void> {
    try {
      await read();
      health.noteOk();
    } catch (e) {
      health.noteFail(`poll:${key}`, e);
      Log.warn('poll', `${what} failed`, e);
    }
  }

  async function pollStatus(d: DspDevice): Promise<void> {
    try {
      // Priority: the 20 Hz status cadence must not stall behind a queued
      // snapshot fetch.
      const s = await session.queue.run(() => d.getSystemStatus(), { priority: true });
      // Status peaks/clip bits are wire-channel indexed; the telemetry store is
      // domain-ChannelId indexed. Shifted on RP2350.
      const hw = d.hardware;
      const peaks: number[] = Array(Domain.ALL_CHANNELS.length).fill(0);
      let clipFlags = 0;
      for (const ch of hw.channels) {
        const wire = Domain.wireChannelFor(hw, ch.id);
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
    await guardedRead('buffer', 'getBufferStats', async () => {
      const b = await session.queue.run(() => d.getBufferStats());
      if (b) {
        tele.bufferStats = b;
        tele.streaming = b.streaming;
        tele.pdmActive = b.pdmActive;
        tele.sequence = b.sequence;
      }
    });
    tele.lastBufferMs = performance.now();
  }

  async function pollInfo(d: DspDevice): Promise<void> {
    await guardedRead('info', 'getSystemInfo', async () => {
      tele.applyPartialInfo(await session.queue.run(() => d.getSystemInfo()));
    });
    if (session.outputLatency.supported === true) {
      // The effective option follows the input source, with no notification.
      await guardedRead('ringHealth', 'getRingHealth', async () => {
        tele.applyRingHealth(await session.queue.run(() => d.getRingHealth()));
      });
      // Skip while an apply is confirming itself; it owns the store then.
      if (!session.outputLatency.busy) {
        await guardedRead('outputLatency', 'getOutputLatencyStatus', async () => {
          const status = await session.queue.run(() => d.getOutputLatencyStatus());
          if (session.alive) session.outputLatency.status = status;
        });
        await guardedRead('outputLatencyOptions', 'getOutputLatencyOptions', async () => {
          const options = await session.queue.run(() => d.getOutputLatencyOptions());
          if (session.alive) session.outputLatency.options = options;
        });
      }
    }
    tele.lastInfoMs = performance.now();
  }

  const pollSpdifRx = (d: DspDevice) => guardedRead('spdifRx', 'getSpdifRxStatus', async () => {
    tele.spdifRxStatus = await session.queue.run(() => d.getSpdifRxStatus());
  });

  const pollI2sSlave = (d: DspDevice) => guardedRead('i2sSlave', 'getI2sSlaveStatus', async () => {
    tele.i2sSlaveStatus = await session.queue.run(() => d.getI2sSlaveStatus());
  });

  const pollAdat = (d: DspDevice) => guardedRead('adat', 'getAdatStatus', async () => {
    tele.adatStatus = await session.queue.run(() => d.getAdatStatus());
  });

  const pollAdatInput = (d: DspDevice) => guardedRead('adatInput', 'getAdatInputStatus', async () => {
    tele.adatInputStatus = await session.queue.run(() => d.getAdatInputStatus());
  });

  // The headroom clock lives on the telemetry store so setSubharmEnabled/Low/
  // High/Boost can zero it to force a fresh re-read (fw spec Sec.6: re-read
  // after every SET) once the scrub settles.
  async function pollSubharm(d: DspDevice): Promise<void> {
    await guardedRead('subharm', 'getSubharmHeadroom', async () => {
      tele.subharmHeadroomDb = await session.queue.run(() => d.getSubharmHeadroom());
    });
    tele.lastSubharmMs = performance.now();
  }

  async function pollSubharmMeter(d: DspDevice): Promise<void> {
    await guardedRead('subharmMeter', 'getSubharmMeter', async () => {
      const meter = await session.queue.run(() => d.getSubharmMeter());
      // Interest may have been released mid-read; a late write would linger.
      if (tele.subharmMeterWanted > 0) tele.subharmMeter = meter;
    });
    tele.lastSubharmMeterMs = performance.now();
  }

  // The status block rides the meter tick at ~1 Hz, or sooner when an action
  // zeroed its clock.
  async function pollLimiterMeter(d: DspDevice): Promise<void> {
    await guardedRead('limiterMeter', 'getLimiterMeter', async () => {
      const now = performance.now();
      const wantStatus = tele.lastLimiterStatusMs === 0 || now - tele.lastLimiterStatusMs >= LIMITER_STATUS_INTERVAL_MS;
      const meter = await session.queue.run(() => d.getLimiterMeter());
      const status = wantStatus ? await session.queue.run(() => d.getLimiterStatus()) : null;
      // Interest may have been released mid-read; a late write would linger.
      if (tele.limiterMeterWanted > 0) {
        tele.limiterMeterDb = meter;
        if (status) {
          tele.limiterStatus = status;
          tele.lastLimiterStatusMs = performance.now();
        }
      }
    });
    tele.lastLimiterMeterMs = performance.now();
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

  function gatesOpen(g: Gates): boolean {
    if (g.feature && !session.device.capabilities?.features[g.feature]) return false;
    if (g.enabled) {
      const snap = mir.current;
      if (!snap || !g.enabled(snap)) return false;
    }
    if (g.wanted && !g.wanted()) return false;
    if (g.healthy && health.degraded) return false;
    if (g.idle && session.writes.busy) return false;
    return true;
  }

  // Interest-gated cadences read only while something is looking: buffer
  // stats (diagnostics panels), the subharm and limiter meters, and the CS
  // macro/display status. Headroom and the meters stand down on a degraded
  // link; headroom is a real GET the device computes fresh, so it also waits
  // out in-flight writes, while the meters keep moving through a scrub. The
  // CS polls take no link gates: their reads are dropped silently on failure.
  const cadences: Cadence[] = [
    { key: 'status', intervalMs: STATUS_INTERVAL_MS, runWhileHidden: false, gates: {},
      lastMs: () => tele.lastStatusMs, run: pollStatus },
    { key: 'buffer', intervalMs: BUFFER_INTERVAL_MS, runWhileHidden: false,
      gates: { wanted: () => tele.bufferStatsWanted > 0 },
      lastMs: () => tele.lastBufferMs, run: pollBuffer },
    { key: 'info', intervalMs: INFO_INTERVAL_MS, runWhileHidden: false, gates: {},
      lastMs: () => tele.lastInfoMs, run: pollInfo },
    { key: 'spdifRx', intervalMs: SPDIF_RX_INTERVAL_MS, runWhileHidden: false,
      gates: { enabled: (m) => Domain.isSpdifSource(m.inputConfig.source) },
      run: pollSpdifRx },
    { key: 'i2sSlave', intervalMs: I2S_SLAVE_INTERVAL_MS, runWhileHidden: false,
      gates: { enabled: (m) => m.inputConfig.i2sClockMode === 1 },
      run: pollI2sSlave },
    { key: 'adat', intervalMs: ADAT_INTERVAL_MS, runWhileHidden: false,
      gates: { feature: 'adatOutput', enabled: (m) => m.adat.enabled },
      run: pollAdat },
    { key: 'adatInput', intervalMs: ADAT_INPUT_INTERVAL_MS, runWhileHidden: false,
      gates: { feature: 'adatInput', enabled: (m) => m.inputConfig.adatInputEnabled },
      run: pollAdatInput },
    { key: 'subharm', intervalMs: SUBHARM_INTERVAL_MS, runWhileHidden: false,
      gates: { feature: 'subharm', enabled: (m) => m.subharm.enabled, healthy: true, idle: true },
      lastMs: () => tele.lastSubharmMs, run: pollSubharm },
    { key: 'subharmMeter', intervalMs: SUBHARM_METER_INTERVAL_MS, runWhileHidden: false,
      gates: {
        feature: 'subharmExt', enabled: (m) => m.subharm.enabled,
        wanted: () => tele.subharmMeterWanted > 0, healthy: true,
      },
      lastMs: () => tele.lastSubharmMeterMs, run: pollSubharmMeter },
    { key: 'limiterMeter', intervalMs: LIMITER_METER_INTERVAL_MS, runWhileHidden: false,
      gates: { feature: 'limiter', wanted: () => tele.limiterMeterWanted > 0, healthy: true },
      lastMs: () => tele.lastLimiterMeterMs, run: pollLimiterMeter },
    { key: 'csExt', intervalMs: CS_EXT_INTERVAL_MS, runWhileHidden: false,
      gates: { wanted: () => cs.extPollWanted > 0 && cs.extStatus?.macroRunning != null },
      run: () => refreshCsExtStatus(session) },
    { key: 'csDisplay', intervalMs: CS_DISPLAY_INTERVAL_MS, runWhileHidden: false,
      gates: { wanted: () => cs.displayPollWanted > 0 && Domain.csDisplaySlotActive(cs.bindings, cs.status) },
      run: () => refreshCsDisplayStatus(session) },
    { key: 'param', intervalMs: PARAM_INTERVAL_MS, runWhileHidden: false, gates: {},
      lastMs: () => tele.lastParamMs, run: pollParam, shouldRun: shouldRunParam },
  ];
  const anyRunWhileHidden = cadences.some((c) => c.runWhileHidden);

  function due(c: Cadence, now: number): boolean {
    if (c.shouldRun) return c.shouldRun(now);
    if (!gatesOpen(c.gates)) return false;
    // A zero clock means never run this session: eligible immediately, not a
    // full interval after the performance.now() epoch.
    const last = c.lastMs ? c.lastMs() : (localLast[c.key] ?? 0);
    return last === 0 || now - last >= c.intervalMs;
  }

  async function doPoll(): Promise<void> {
    if (stopped || !session.alive) return;
    const d = session.device;
    const now = performance.now();
    for (const c of cadences) {
      if (isHidden() && !c.runWhileHidden) continue;
      if (inFlight.has(c.key) || !due(c, now)) continue;
      inFlight.add(c.key);
      try {
        await c.run(d);
      } finally {
        inFlight.delete(c.key);
        if (!c.lastMs) localLast[c.key] = performance.now();
      }
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
