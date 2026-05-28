import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseBulkParams } from '@/protocol';
import { makeBulk } from '@test/fixtures/bulkFixtures';
import { PlatformType, createHardwareProfile } from '@/domain';
import { fromBulkParams } from '@/device/snapshotCodec';
import type { DspDevice } from '@/device/DspDevice';
import {
  bindDevice, session, setStatus, dsp, resetDsp, applyDraftSnapshot,
  applyBaselineSnapshot, isInFlight,
} from '@/state';
import {
  enqueue, flush as flushWrites, cancel as cancelWrites,
  applyBaselineConverged, awaitBulkSettled, convergeBulk, cancelBulkFlush,
} from './outbox';
import { scheduleResync } from './resync';

// ---------------------------------------------------------------------------
// Granular lane. Entry point is enqueue({ control, coalesceKey, apply, send });
// 'outputGain' / 'masterVolume' are granular controls in CONTROL_POLICY, so they
// exercise the granular lane.
// ---------------------------------------------------------------------------

const testHardware = createHardwareProfile(PlatformType.RP2350);

function initializedDevice(methods: Partial<DspDevice>): DspDevice {
  return {
    info: {
      serial: 'TEST-RP2350',
      firmwareVersion: '1.0.0',
      platformType: PlatformType.RP2350,
      hardware: testHardware,
    },
    hardware: testHardware,
    ...methods,
  } as DspDevice;
}

function makeGainDevice() {
  const calls: Array<[number, number]> = [];
  const validBulk = parseBulkParams(makeBulk());
  return {
    device: initializedDevice({
      setOutputGain: vi.fn(async (output: number, db: number) => { calls.push([output, db]); }),
      getAllParams: vi.fn(async () => validBulk),
    }),
    calls,
  };
}

describe('enqueue (granular)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    const bulk = parseBulkParams(makeBulk());
    // resetDsp clears draft + pendingWrites; applyDraftSnapshot then seeds draft.
    resetDsp();
    applyDraftSnapshot(fromBulkParams(createHardwareProfile(PlatformType.RP2350), bulk));
    // Reset session status so leaked 'error' from a prior test in the suite
    // does not pollute assertions in tests that don't explicitly set status.
    setStatus('idle');
    // Drop any module-scoped lanes left over from prior tests so each test
    // starts with a clean per-key registry.
    cancelWrites();
  });
  afterEach(() => {
    cancelWrites();
    vi.useRealTimers();
    bindDevice(null);
  });

  it('applies optimistic patch on every call', () => {
    bindDevice(makeGainDevice().device);
    const seen: number[] = [];
    for (const v of [-3, -6, -9]) {
      enqueue({
        control: 'outputGain',
        coalesceKey: 'outputGain:0',
        apply: () => { seen.push(v); },
        send: async () => {},
      });
    }
    expect(seen).toEqual([-3, -6, -9]);
  });

  it('coalesces a burst on one key to a single send of the latest payload', async () => {
    const { device, calls } = makeGainDevice();
    bindDevice(device);
    for (const v of [-3, -6, -9]) {
      enqueue({
        control: 'outputGain',
        coalesceKey: 'outputGain:0',
        apply: () => {},
        send: async (d) => { await d.setOutputGain(0, v); },
      });
    }
    await vi.runAllTimersAsync();
    expect(calls).toEqual([[0, -9]]);
  });

  it('different keys do not cannibalize each other', async () => {
    const { device, calls } = makeGainDevice();
    bindDevice(device);
    enqueue({
      control: 'outputGain',
      coalesceKey: 'outputGain:0',
      apply: () => {},
      send: async (d) => { await d.setOutputGain(0, -3); },
    });
    enqueue({
      control: 'outputGain',
      coalesceKey: 'outputGain:1',
      apply: () => {},
      send: async (d) => { await d.setOutputGain(1, -6); },
    });
    await vi.runAllTimersAsync();
    expect(calls).toEqual(expect.arrayContaining([[0, -3], [1, -6]]));
    expect(calls).toHaveLength(2);
  });

  it('clears pending after a successful flush', async () => {
    const { device } = makeGainDevice();
    bindDevice(device);
    enqueue({
      control: 'outputGain',
      coalesceKey: 'outputGain:0',
      apply: () => {},
      send: async (d) => { await d.setOutputGain(0, -3); },
    });
    expect(dsp.pendingWrites.size).toBeGreaterThan(0);
    await vi.runAllTimersAsync();
    expect(dsp.pendingWrites.size).toBe(0);
  });

  it('forces resync + sets error on send failure (current generation)', async () => {
    const validBulk = parseBulkParams(makeBulk());
    const device = initializedDevice({
      setOutputGain: vi.fn(async () => { throw new Error('range'); }),
      getAllParams: vi.fn(async () => validBulk),
    });
    bindDevice(device);
    enqueue({
      control: 'outputGain',
      coalesceKey: 'outputGain:0',
      apply: () => {},
      send: async (d) => { await d.setOutputGain(0, -3); },
    });
    await vi.runAllTimersAsync();
    expect(session.status).toBe('error');
  });
});

describe('cancel (granular teardown)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    const bulk = parseBulkParams(makeBulk());
    // resetDsp clears draft + pendingWrites; applyDraftSnapshot then seeds draft.
    resetDsp();
    applyDraftSnapshot(fromBulkParams(createHardwareProfile(PlatformType.RP2350), bulk));
    // Reset session status so a leaked 'error' from a prior test in the suite
    // does not pollute these assertions.
    setStatus('idle');
  });
  afterEach(() => {
    vi.useRealTimers();
    bindDevice(null);
  });

  it('drops queued granular timers and clears pending lane tokens', async () => {
    const { device, calls } = makeGainDevice();
    bindDevice(device);
    enqueue({
      control: 'outputGain',
      coalesceKey: 'outputGain:0',
      apply: () => {},
      send: async (d) => { await d.setOutputGain(0, -3); },
    });
    expect(dsp.pendingWrites.size).toBe(1);

    cancelWrites();
    expect(dsp.pendingWrites.size).toBe(0);

    await vi.runAllTimersAsync();
    expect(calls).toEqual([]);
  });

  it('bumps session generation so an in-flight granular send settles as stale', async () => {
    let resolveSend: () => void = () => {};
    const validBulk = parseBulkParams(makeBulk());
    const device = initializedDevice({
      setOutputGain: vi.fn(() => new Promise<void>((res) => { resolveSend = res; })),
      getAllParams: vi.fn(async () => validBulk),
    });
    bindDevice(device);

    enqueue({
      control: 'outputGain',
      coalesceKey: 'outputGain:0',
      apply: () => {},
      send: async (d) => { await d.setOutputGain(0, -3); },
    });
    await vi.advanceTimersByTimeAsync(16);   // fire the lane: send is now in flight (parked)
    expect(dsp.pendingWrites.size).toBe(1);

    cancelWrites();
    expect(dsp.pendingWrites.size).toBe(0);
    expect(session.status).not.toBe('error');

    // Resolve the in-flight send. It should NOT trigger scheduleResync
    // because gen !== session.generation now. Status must stay clean.
    resolveSend();
    await vi.runAllTimersAsync();
    expect(session.status).not.toBe('error');
  });

  it('an in-flight granular rejection after cancel does NOT flip status to error', async () => {
    let rejectSend: (err: Error) => void = () => {};
    const validBulk = parseBulkParams(makeBulk());
    const device = initializedDevice({
      setOutputGain: vi.fn(() => new Promise<void>((_, rej) => { rejectSend = rej; })),
      getAllParams: vi.fn(async () => validBulk),
    });
    bindDevice(device);

    enqueue({
      control: 'outputGain',
      coalesceKey: 'outputGain:0',
      apply: () => {},
      send: async (d) => { await d.setOutputGain(0, -3); },
    });
    await vi.advanceTimersByTimeAsync(16);   // fire the lane: send is now in flight (parked)
    expect(dsp.pendingWrites.size).toBe(1);

    cancelWrites();
    expect(session.status).not.toBe('error');

    // Reject the in-flight send AFTER cancel. The catch branch must observe
    // gen !== session.generation and skip setStatus('error', ...).
    rejectSend(new Error('post-cancel rejection'));
    await vi.runAllTimersAsync();
    expect(session.status).not.toBe('error');
  });
});

// ---------------------------------------------------------------------------
// Bulk lane. enqueue({ control, mutate }) is the immediate path,
// enqueue({ control, debounceKey, mutate }) the debounced one. 'channelName' is
// bulk-immediate, 'levellerAmount' bulk-debounced. The mutators touch
// s.masterVolumeDb only to bump the lane revision — the lane is field-agnostic.
// ---------------------------------------------------------------------------

const hw = createHardwareProfile(PlatformType.RP2350);

// Spin the microtask/macrotask queue (real timers) until `cond` holds, so tests
// don't depend on a hard-coded number of `await Promise.resolve()` ticks.
async function waitUntil(cond: () => boolean, tries = 100): Promise<void> {
  for (let i = 0; i < tries && !cond(); i += 1) {
    await new Promise((res) => setTimeout(res, 0));
  }
}

// `send` models the device-side bulk write: the lane now calls d.applyBulk(draft),
// so the spy stands in for applyBulk. Tests pass a callback to count sends, defer
// resolution, or throw. hasState is true (a snapshot has been fetched), which is
// the connect-race guard the lane checks before sending. getSnapshot feeds the
// trailing-resync path; it returns the seed snapshot.
function bindBulkDevice(send: (b: unknown) => Promise<void>): void {
  const bulk = parseBulkParams(makeBulk());
  const snap = fromBulkParams(hw, bulk);
  const d = {
    info: { serial: 'T', firmwareVersion: '6.0.0', platformType: PlatformType.RP2350, hardware: hw },
    hardware: hw,
    hasState: true,
    applyBulk: vi.fn(send),
    setAllParams: vi.fn(async () => {}),
    getAllParams: vi.fn(async () => bulk),
    getSnapshot: vi.fn(async () => fromBulkParams(hw, bulk)),
  } as unknown as DspDevice;
  bindDevice(d);
  applyBaselineSnapshot(snap);
  setStatus('connected');
}

describe('enqueue (bulk immediate)', () => {
  beforeEach(() => {
    resetDsp();
    cancelBulkFlush();
  });
  afterEach(() => { bindDevice(null); setStatus('idle'); });

  it('applies the mutator optimistically and sends one bulk write', async () => {
    let sends = 0;
    bindBulkDevice(async () => { sends += 1; });
    enqueue({ control: 'channelName', mutate: (s) => { s.masterVolumeDb = -12; } });
    expect(dsp.draft?.masterVolumeDb).toBe(-12);
    await awaitBulkSettled();
    expect(sends).toBe(1);
    expect(isInFlight.current).toBe(false); // converged: lane idle after the send lands
  });

  it('coalesces: commits during an in-flight send trigger exactly one more send', async () => {
    let resolveSend!: () => void;
    let sends = 0;
    bindBulkDevice(() => { sends += 1; return new Promise<void>((res) => { resolveSend = res; }); });
    enqueue({ control: 'channelName', mutate: (s) => { s.masterVolumeDb = -1; } });
    enqueue({ control: 'channelName', mutate: (s) => { s.masterVolumeDb = -2; } });
    enqueue({ control: 'channelName', mutate: (s) => { s.masterVolumeDb = -3; } });
    expect(sends).toBe(1);
    resolveSend();                 // settle send #1
    await Promise.resolve();       // run settle continuation + synchronous re-flush (starts send #2)
    await Promise.resolve();
    expect(sends).toBe(2);         // exactly one more send carries the latest state
    resolveSend();                 // settle send #2 so no promise dangles
    await waitUntil(() => !isInFlight.current);
    expect(isInFlight.current).toBe(false); // converged on latest: lane idle
  });

  it('on send failure sets error status and leaves the lane usable (not wedged)', async () => {
    let sends = 0;
    bindBulkDevice(async () => { sends += 1; throw new Error('wire fail'); });
    enqueue({ control: 'channelName', mutate: (s) => { s.masterVolumeDb = -5; } });
    await awaitBulkSettled().catch(() => {});
    await waitUntil(() => session.status === 'error');
    expect(session.status).toBe('error');
    expect(sends).toBe(1);
    // The in-flight slot was cleared on settle: a fresh edit still fires a send.
    // A wedged lane (stale inflight not nulled) would suppress this second send.
    enqueue({ control: 'channelName', mutate: (s) => { s.masterVolumeDb = -6; } });
    expect(sends).toBe(2);
  });

  it('settle is silent (does not advance lastSentRev) when generation changed mid-flight', async () => {
    let resolveSend!: () => void;
    let sends = 0;
    bindBulkDevice(() => { sends += 1; return new Promise<void>((res) => { resolveSend = res; }); });
    enqueue({ control: 'channelName', mutate: (s) => { s.masterVolumeDb = -7; } });
    expect(sends).toBe(1);
    session.generation += 1;     // disconnect/cancel bumps the generation
    resolveSend();
    await awaitBulkSettled();
    // Stale settle is a silent no-op for the *data*: it must NOT advance
    // lastSentRev. The edit therefore still reads as unsent — observable because
    // a plain converge (which sends iff currentRev > lastSentRev) re-fires the
    // send. A settle that wrongly advanced lastSentRev would suppress this.
    convergeBulk();
    await waitUntil(() => sends >= 2);
    expect(sends).toBeGreaterThanOrEqual(2);
  });

  it('cancel clears the bulk lane so it is idle and not wedged', () => {
    let sends = 0;
    bindBulkDevice(() => { sends += 1; return new Promise<void>(() => { /* never resolves */ }); });
    enqueue({ control: 'channelName', mutate: (s) => { s.masterVolumeDb = -4; } });
    expect(sends).toBe(1);
    expect(isInFlight.current).toBe(true);   // lane busy
    cancelWrites();
    expect(isInFlight.current).toBe(false);  // counters + token cleared: lane idle
    // inflight slot detached (not just the token): a fresh edit starts a new send
    // rather than being suppressed by the never-resolving stale promise.
    enqueue({ control: 'channelName', mutate: (s) => { s.masterVolumeDb = -8; } });
    expect(sends).toBe(2);
  });

  it('a detached stale send cannot clear or duplicate a newer in-flight bulk send', async () => {
    const resolvers: Array<() => void> = [];
    let sends = 0;
    bindBulkDevice(() => { sends += 1; return new Promise<void>((res) => { resolvers.push(res); }); });

    enqueue({ control: 'channelName', mutate: (s) => { s.masterVolumeDb = -4; } });   // send A parks in flight
    expect(sends).toBe(1);
    expect(isInFlight.current).toBe(true);

    cancelWrites();                              // detaches A, bumps generation
    enqueue({ control: 'channelName', mutate: (s) => { s.masterVolumeDb = -8; } });   // send B parks in flight
    expect(sends).toBe(2);
    expect(isInFlight.current).toBe(true);            // B holds the lane

    resolvers[0]();                                   // settle the stale send A
    await Promise.resolve();
    await Promise.resolve();
    expect(sends).toBe(2);                            // A's settle fired no spurious re-send
    expect(isInFlight.current).toBe(true);            // and did not clear B's lane

    resolvers[1]();                                   // settle the live send B
    await waitUntil(() => !isInFlight.current);
    expect(isInFlight.current).toBe(false);           // lane idle only once the live send lands
  });
});

describe('enqueue (bulk debounced)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    cancelBulkFlush();
  });
  afterEach(() => { vi.useRealTimers(); bindDevice(null); setStatus('idle'); });

  it('coalesces rapid edits on one key into a single bulk send after 16ms idle', async () => {
    let sends = 0;
    bindBulkDevice(async () => { sends += 1; });
    enqueue({ control: 'levellerAmount', debounceKey: 'levellerAmount', mutate: (s) => { if (s.leveller) s.leveller.amount = 10; } });
    enqueue({ control: 'levellerAmount', debounceKey: 'levellerAmount', mutate: (s) => { if (s.leveller) s.leveller.amount = 20; } });
    enqueue({ control: 'levellerAmount', debounceKey: 'levellerAmount', mutate: (s) => { if (s.leveller) s.leveller.amount = 30; } });
    expect(sends).toBe(0);
    expect(dsp.draft?.leveller?.amount).toBe(30);
    await vi.advanceTimersByTimeAsync(16);
    await awaitBulkSettled();
    expect(sends).toBe(1);
  });
});

describe('flush (flushWrites)', () => {
  beforeEach(() => { cancelBulkFlush(); });
  afterEach(() => { bindDevice(null); setStatus('idle'); });

  it('fires a pending debounced edit and resolves only after the bulk lands', async () => {
    let sends = 0;
    bindBulkDevice(async () => { sends += 1; });
    enqueue({ control: 'levellerAmount', debounceKey: 'levellerAmount', mutate: (s) => { if (s.leveller) s.leveller.amount = 42; } });
    expect(sends).toBe(0);
    await flushWrites();
    expect(sends).toBe(1);
    expect(isInFlight.current).toBe(false); // converged: lane idle after flush
  });

  it('is a no-op (no bulk send) when nothing is pending', async () => {
    let sends = 0;
    bindBulkDevice(async () => { sends += 1; });
    // no edits
    await flushWrites();
    expect(sends).toBe(0);
  });

  it('drains a pending granular lane before resolving', async () => {
    bindBulkDevice(async () => {});
    let granularSent = false;
    enqueue({ control: 'masterVolume', coalesceKey: 'masterVolume', apply: () => {}, send: async () => { granularSent = true; } });
    await flushWrites();
    expect(granularSent).toBe(true);
  });

  it('converges with one more flush if an edit lands during the drain', async () => {
    // Deferred sends so we control exactly when each bulk write settles, and can
    // land a fresh edit while the first bulk is parked in-flight.
    const resolvers: Array<() => void> = [];
    let sends = 0;
    bindBulkDevice(() => { sends += 1; return new Promise<void>((res) => { resolvers.push(res); }); });

    // First edit fires send #1, which parks on its unresolved promise.
    enqueue({ control: 'channelName', mutate: (s) => { s.masterVolumeDb = -1; } });
    expect(sends).toBe(1);
    expect(isInFlight.current).toBe(true);

    const pending = flushWrites();

    // Land another edit mid-drain (unsent work on the lane while send #1 is parked).
    enqueue({ control: 'channelName', mutate: (s) => { s.masterVolumeDb = -2; } });
    expect(isInFlight.current).toBe(true);

    // Pause the lane (error status) so the bulk path's own finally-reflush is
    // suppressed (the finally gates on 'connected'). The ONLY path that can now
    // carry the mid-drain edit is flush()'s converge branch.
    setStatus('error');

    // Settle send #1. Its finally sees status !== 'connected' and does NOT reflush,
    // so the mid-drain edit can only be carried by flush()'s converge branch.
    resolvers[0]();

    // Wait for flush()'s converge branch to fire send #2 (real timers).
    await waitUntil(() => sends === 2);
    expect(sends).toBe(2);                 // converge branch fired the extra flush

    // Settle send #2 so flush() resolves; gen unchanged so it commits lastSentRev.
    resolvers[1]();
    await pending;

    expect(isInFlight.current).toBe(false); // converged: lane idle once flush() resolves
  });
});

describe('enqueue bulk — pendingWrites token (Finding 1)', () => {
  beforeEach(() => {
    resetDsp();
    cancelBulkFlush();
  });
  afterEach(() => { bindDevice(null); setStatus('idle'); });

  it('holds a pendingWrites token while a bulk write is in flight and releases on settle', async () => {
    let resolveSend!: () => void;
    bindBulkDevice(() => new Promise<void>((res) => { resolveSend = res; }));
    enqueue({ control: 'channelName', mutate: (s) => { s.masterVolumeDb = -3; } });
    expect(dsp.pendingWrites.size).toBe(1);     // token present during flight
    expect(isInFlight.current).toBe(true);
    resolveSend();
    await awaitBulkSettled();
    await waitUntil(() => dsp.pendingWrites.size === 0);
    expect(dsp.pendingWrites.size).toBe(0);     // released on settle
    expect(isInFlight.current).toBe(false);
  });
});

describe('resync guard sees the bulk lane (Finding 1)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetDsp();
    cancelBulkFlush();
  });
  afterEach(() => { vi.useRealTimers(); bindDevice(null); setStatus('idle'); });

  it('a trailing resync does not clobber an in-flight bulk edit', async () => {
    let resolveSend!: () => void;
    bindBulkDevice(() => new Promise<void>((res) => { resolveSend = res; }));
    enqueue({ control: 'channelName', mutate: (s) => { s.masterVolumeDb = -12; } });   // optimistic; send parked in flight
    expect(dsp.draft?.masterVolumeDb).toBe(-12);
    scheduleResync();
    await vi.advanceTimersByTimeAsync(300);            // trailing fetch fires (~250ms)
    expect(dsp.draft?.masterVolumeDb).toBe(-12);        // guard saw the token: not reverted
    resolveSend();
    await awaitBulkSettled();
  });
});

describe('applyBaselineConverged', () => {
  beforeEach(() => { resetDsp(); cancelBulkFlush(); });
  afterEach(() => { bindDevice(null); setStatus('idle'); });

  it('marks the lane converged so pre-baseline edits are not re-sent', async () => {
    let sends = 0;
    bindBulkDevice(async () => { sends += 1; });
    // A debounced edit bumps the lane's pending revision WITHOUT sending yet.
    enqueue({ control: 'levellerAmount', debounceKey: 'levellerAmount', mutate: (s) => { if (s.leveller) s.leveller.amount = 7; } });
    expect(sends).toBe(0);
    // The debounced edit added BULK_TOKEN to pendingWrites.
    expect(isInFlight.current).toBe(true);
    // Applying a fresh baseline must reset the lane to "no unsent edits" AND
    // re-derive the pending token, so nothing stays stuck dirty.
    applyBaselineConverged(fromBulkParams(hw, parseBulkParams(makeBulk())));
    expect(dsp.pendingWrites.size).toBe(0);
    expect(isInFlight.current).toBe(false);
    // Drain: a correctly-converged lane fires NO send. A lane that kept the stale
    // pending revision would re-send the discarded pre-baseline edit here.
    await flushWrites();
    expect(sends).toBe(0);
  });
});
