import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SvelteSet } from 'svelte/reactivity';
import { parseBulkParams } from '@/protocol';
import { makeBulk } from '@test/fixtures/bulkFixtures';
import { PlatformType, createHardwareProfile } from '@/domain';
import type { DspDevice } from '@/device/DspDevice';
import { fromBulkParams } from '@/device/snapshotCodec';
import { bindDevice, session, setStatus, dsp, applyBaselineSnapshot, isInFlight } from '@/state';
import { commitBulk, commitBulkDebounced, cancelBulkFlush, awaitBulkSettled, convergeBulk, applyBaselineConverged } from './commit';
import { flushPending, cancelAllCommands } from './outbox';
import { scrubCommand } from './commands';
import { scheduleResync } from './resync';

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

describe('commitBulk', () => {
  beforeEach(() => {
    dsp.pendingWrites = new SvelteSet();
    cancelBulkFlush();
  });
  afterEach(() => { bindDevice(null); setStatus('idle'); });

  it('applies the mutator optimistically and sends one bulk write', async () => {
    let sends = 0;
    bindBulkDevice(async () => { sends += 1; });
    commitBulk((s) => { s.masterVolumeDb = -12; });
    expect(dsp.live?.masterVolumeDb).toBe(-12);
    await awaitBulkSettled();
    expect(sends).toBe(1);
    expect(isInFlight.current).toBe(false); // converged: lane idle after the send lands
  });

  it('coalesces: commits during an in-flight send trigger exactly one more send', async () => {
    let resolveSend!: () => void;
    let sends = 0;
    bindBulkDevice(() => { sends += 1; return new Promise<void>((res) => { resolveSend = res; }); });
    commitBulk((s) => { s.masterVolumeDb = -1; });
    commitBulk((s) => { s.masterVolumeDb = -2; });
    commitBulk((s) => { s.masterVolumeDb = -3; });
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
    commitBulk((s) => { s.masterVolumeDb = -5; });
    await awaitBulkSettled().catch(() => {});
    await waitUntil(() => session.status === 'error');
    expect(session.status).toBe('error');
    expect(sends).toBe(1);
    // The in-flight slot was cleared on settle: a fresh edit still fires a send.
    // A wedged lane (stale inflight not nulled) would suppress this second send.
    commitBulk((s) => { s.masterVolumeDb = -6; });
    expect(sends).toBe(2);
  });

  it('settle is silent (does not advance lastSentRev) when generation changed mid-flight', async () => {
    let resolveSend!: () => void;
    let sends = 0;
    bindBulkDevice(() => { sends += 1; return new Promise<void>((res) => { resolveSend = res; }); });
    commitBulk((s) => { s.masterVolumeDb = -7; });
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

  it('cancelAllCommands clears the bulk lane so it is idle and not wedged', () => {
    let sends = 0;
    bindBulkDevice(() => { sends += 1; return new Promise<void>(() => { /* never resolves */ }); });
    commitBulk((s) => { s.masterVolumeDb = -4; });
    expect(sends).toBe(1);
    expect(isInFlight.current).toBe(true);   // lane busy
    cancelAllCommands();
    expect(isInFlight.current).toBe(false);  // counters + token cleared: lane idle
    // inflight slot detached (not just the token): a fresh edit starts a new send
    // rather than being suppressed by the never-resolving stale promise.
    commitBulk((s) => { s.masterVolumeDb = -8; });
    expect(sends).toBe(2);
  });

  it('a detached stale send cannot clear or duplicate a newer in-flight bulk send', async () => {
    const resolvers: Array<() => void> = [];
    let sends = 0;
    bindBulkDevice(() => { sends += 1; return new Promise<void>((res) => { resolvers.push(res); }); });

    commitBulk((s) => { s.masterVolumeDb = -4; });   // send A parks in flight
    expect(sends).toBe(1);
    expect(isInFlight.current).toBe(true);

    cancelAllCommands();                              // detaches A, bumps generation
    commitBulk((s) => { s.masterVolumeDb = -8; });   // send B parks in flight
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

describe('commitBulkDebounced', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    cancelBulkFlush();
  });
  afterEach(() => { vi.useRealTimers(); bindDevice(null); setStatus('idle'); });

  it('coalesces rapid edits on one key into a single bulk send after 16ms idle', async () => {
    let sends = 0;
    bindBulkDevice(async () => { sends += 1; });
    commitBulkDebounced('levellerAmount', (s) => { if (s.leveller) s.leveller.amount = 10; });
    commitBulkDebounced('levellerAmount', (s) => { if (s.leveller) s.leveller.amount = 20; });
    commitBulkDebounced('levellerAmount', (s) => { if (s.leveller) s.leveller.amount = 30; });
    expect(sends).toBe(0);
    expect(dsp.live?.leveller?.amount).toBe(30);
    await vi.advanceTimersByTimeAsync(16);
    await awaitBulkSettled();
    expect(sends).toBe(1);
  });
});

describe('flushPending', () => {
  beforeEach(() => { cancelBulkFlush(); });
  afterEach(() => { bindDevice(null); setStatus('idle'); });

  it('fires a pending debounced edit and resolves only after the bulk lands', async () => {
    let sends = 0;
    bindBulkDevice(async () => { sends += 1; });
    commitBulkDebounced('levellerAmount', (s) => { if (s.leveller) s.leveller.amount = 42; });
    expect(sends).toBe(0);
    await flushPending();
    expect(sends).toBe(1);
    expect(isInFlight.current).toBe(false); // converged: lane idle after flush
  });

  it('is a no-op (no bulk send) when nothing is pending', async () => {
    let sends = 0;
    bindBulkDevice(async () => { sends += 1; });
    // no edits
    await flushPending();
    expect(sends).toBe(0);
  });

  it('drains a pending Tier-A scrub lane before resolving', async () => {
    bindBulkDevice(async () => {});
    let scrubSent = false;
    scrubCommand({ key: 'masterVolume', apply: () => {}, send: async () => { scrubSent = true; } });
    await flushPending();
    expect(scrubSent).toBe(true);
  });

  it('converges with one more flush if an edit lands during the drain', async () => {
    // Deferred sends so we control exactly when each bulk write settles, and can
    // land a fresh edit while the first bulk is parked in-flight.
    const resolvers: Array<() => void> = [];
    let sends = 0;
    bindBulkDevice(() => { sends += 1; return new Promise<void>((res) => { resolvers.push(res); }); });

    // First edit fires send #1, which parks on its unresolved promise.
    commitBulk((s) => { s.masterVolumeDb = -1; });
    expect(sends).toBe(1);
    expect(isInFlight.current).toBe(true);

    const pending = flushPending();

    // Land another edit mid-drain (unsent work on the lane while send #1 is parked).
    commitBulk((s) => { s.masterVolumeDb = -2; });
    expect(isInFlight.current).toBe(true);

    // Pause the lane (error status) so commitBulk's own finally-reflush is
    // suppressed (commit.ts:46 gates on 'connected'). The ONLY path that can now
    // carry the mid-drain edit is flushPending's converge branch (commit.ts:81-84).
    setStatus('error');

    // Settle send #1. Its finally sees status !== 'connected' and does NOT reflush,
    // so the mid-drain edit can only be carried by flushPending's converge branch.
    resolvers[0]();

    // Wait for flushPending's converge branch to fire send #2 (real timers).
    await waitUntil(() => sends === 2);
    expect(sends).toBe(2);                 // converge branch fired the extra flush

    // Settle send #2 so flushPending resolves; gen unchanged so it commits lastSentRev.
    resolvers[1]();
    await pending;

    expect(isInFlight.current).toBe(false); // converged: lane idle once flushPending resolves
  });
});

describe('commitBulk — pendingWrites token (Finding 1)', () => {
  beforeEach(() => {
    dsp.pendingWrites = new SvelteSet();
    cancelBulkFlush();
  });
  afterEach(() => { bindDevice(null); setStatus('idle'); });

  it('holds a pendingWrites token while a bulk write is in flight and releases on settle', async () => {
    let resolveSend!: () => void;
    bindBulkDevice(() => new Promise<void>((res) => { resolveSend = res; }));
    commitBulk((s) => { s.masterVolumeDb = -3; });
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
    dsp.pendingWrites = new SvelteSet();
    cancelBulkFlush();
  });
  afterEach(() => { vi.useRealTimers(); bindDevice(null); setStatus('idle'); });

  it('a trailing resync does not clobber an in-flight bulk edit', async () => {
    let resolveSend!: () => void;
    bindBulkDevice(() => new Promise<void>((res) => { resolveSend = res; }));
    commitBulk((s) => { s.masterVolumeDb = -12; });   // optimistic; send parked in flight
    expect(dsp.live?.masterVolumeDb).toBe(-12);
    scheduleResync();
    await vi.advanceTimersByTimeAsync(300);            // trailing fetch fires (~250ms)
    expect(dsp.live?.masterVolumeDb).toBe(-12);        // guard saw the token: not reverted
    resolveSend();
    await awaitBulkSettled();
  });
});

describe('applyBaselineConverged', () => {
  beforeEach(() => { dsp.pendingWrites = new SvelteSet(); cancelBulkFlush(); });
  afterEach(() => { bindDevice(null); setStatus('idle'); });

  it('marks the lane converged so pre-baseline edits are not re-sent', async () => {
    let sends = 0;
    bindBulkDevice(async () => { sends += 1; });
    // A debounced edit bumps the lane's pending revision WITHOUT sending yet.
    commitBulkDebounced('levellerAmount', (s) => { if (s.leveller) s.leveller.amount = 7; });
    expect(sends).toBe(0);
    // Applying a fresh baseline must reset the lane to "no unsent edits".
    applyBaselineConverged(fromBulkParams(hw, parseBulkParams(makeBulk())));
    // Drain: a correctly-converged lane fires NO send. A lane that kept the stale
    // pending revision would re-send the discarded pre-baseline edit here.
    await flushPending();
    expect(sends).toBe(0);
  });
});
