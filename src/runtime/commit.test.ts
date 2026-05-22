import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SvelteSet } from 'svelte/reactivity';
import { parseBulkParams } from '@/protocol';
import { makeBulk } from '@test/fixtures/bulkFixtures';
import { PlatformType, fromBulkParams, createHardwareProfile } from '@/domain';
import type { DspDevice } from '@/device/DspDevice';
import { bindDevice, session, setStatus, dsp, applyDspSnapshot, isInFlight } from '@/state';
import { commitBulk, commitBulkDebounced } from './commit';
import { flushPending, cancelAllCommands } from './outbox';

const hw = createHardwareProfile(PlatformType.RP2350);

// Spin the microtask/macrotask queue (real timers) until `cond` holds, so tests
// don't depend on a hard-coded number of `await Promise.resolve()` ticks.
async function waitUntil(cond: () => boolean, tries = 100): Promise<void> {
  for (let i = 0; i < tries && !cond(); i += 1) {
    await new Promise((res) => setTimeout(res, 0));
  }
}

function bindBulkDevice(setAll: (b: unknown) => Promise<void>): void {
  const bulk = parseBulkParams(makeBulk());
  const d = {
    info: { serial: 'T', firmwareVersion: '6.0.0', platformType: PlatformType.RP2350, hardware: hw },
    hardware: hw,
    setAllParams: vi.fn(setAll),
    getAllParams: vi.fn(async () => bulk),
  } as unknown as DspDevice;
  bindDevice(d);
  applyDspSnapshot(fromBulkParams(hw, bulk), bulk);
  setStatus('connected');
}

describe('commitBulk', () => {
  beforeEach(() => {
    dsp.pendingWrites = new SvelteSet();
    dsp.flush.inflight = null;
    dsp.flush.currentRev = 0;
    dsp.flush.lastSentRev = 0;
    dsp.flush.tierAPending = 0;
    dsp.flush.tierAMirrorRev = 0;
    dsp.flush.failureCount = 0;
  });
  afterEach(() => { bindDevice(null); setStatus('idle'); });

  it('applies the mutator optimistically and sends one bulk write', async () => {
    let sends = 0;
    bindBulkDevice(async () => { sends += 1; });
    commitBulk((s) => { s.masterVolumeDb = -12; });
    expect(dsp.live?.masterVolumeDb).toBe(-12);
    await dsp.flush.inflight;
    expect(sends).toBe(1);
    expect(dsp.flush.lastSentRev).toBe(dsp.flush.currentRev);
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
    await Promise.resolve();
    expect(dsp.flush.lastSentRev).toBe(dsp.flush.currentRev); // converged on latest
  });

  it('on send failure sets error status and clears inflight', async () => {
    bindBulkDevice(async () => { throw new Error('wire fail'); });
    commitBulk((s) => { s.masterVolumeDb = -5; });
    await dsp.flush.inflight?.catch(() => {});
    await Promise.resolve();
    expect(session.status).toBe('error');
    expect(dsp.flush.inflight).toBeNull();
  });

  it('settle is silent when generation changed mid-flight', async () => {
    let resolveSend!: () => void;
    bindBulkDevice(() => new Promise<void>((res) => { resolveSend = res; }));
    commitBulk((s) => { s.masterVolumeDb = -7; });
    const before = dsp.flush.lastSentRev;
    session.generation += 1;
    resolveSend();
    await dsp.flush.inflight;
    expect(dsp.flush.lastSentRev).toBe(before);
  });

  it('cancelAllCommands resets flush counters and detaches inflight', async () => {
    bindBulkDevice(() => new Promise<void>(() => { /* never resolves */ }));
    commitBulk((s) => { s.masterVolumeDb = -4; });
    expect(dsp.flush.currentRev).toBe(1);
    cancelAllCommands();
    expect(dsp.flush.inflight).toBeNull();
    expect(dsp.flush.currentRev).toBe(0);
    expect(dsp.flush.lastSentRev).toBe(0);
  });
});

describe('commitBulkDebounced', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    dsp.flush.inflight = null;
    dsp.flush.currentRev = 0;
    dsp.flush.lastSentRev = 0;
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
    await dsp.flush.inflight;
    expect(sends).toBe(1);
  });
});

describe('flushPending', () => {
  beforeEach(() => { dsp.flush.inflight = null; dsp.flush.currentRev = 0; dsp.flush.lastSentRev = 0; });
  afterEach(() => { bindDevice(null); setStatus('idle'); });

  it('fires a pending debounced edit and resolves only after the bulk lands', async () => {
    let sends = 0;
    bindBulkDevice(async () => { sends += 1; });
    commitBulkDebounced('levellerAmount', (s) => { if (s.leveller) s.leveller.amount = 42; });
    expect(sends).toBe(0);
    await flushPending();
    expect(sends).toBe(1);
    expect(dsp.flush.currentRev).toBe(dsp.flush.lastSentRev);
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
    const { scrubCommand } = await import('./commands');
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
    expect(dsp.flush.inflight).not.toBeNull();

    const pending = flushPending();

    // Land another edit mid-drain so currentRev > lastSentRev.
    commitBulk((s) => { s.masterVolumeDb = -2; });
    expect(dsp.flush.currentRev).toBeGreaterThan(dsp.flush.lastSentRev);

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

    expect(dsp.flush.currentRev).toBe(dsp.flush.lastSentRev); // converged
  });
});

describe('commitBulk — pendingWrites token (Finding 1)', () => {
  beforeEach(() => {
    dsp.pendingWrites = new SvelteSet();
    dsp.flush.inflight = null;
    dsp.flush.currentRev = 0;
    dsp.flush.lastSentRev = 0;
  });
  afterEach(() => { bindDevice(null); setStatus('idle'); });

  it('holds a pendingWrites token while a bulk write is in flight and releases on settle', async () => {
    let resolveSend!: () => void;
    bindBulkDevice(() => new Promise<void>((res) => { resolveSend = res; }));
    commitBulk((s) => { s.masterVolumeDb = -3; });
    expect(dsp.pendingWrites.size).toBe(1);     // token present during flight
    expect(isInFlight.current).toBe(true);
    resolveSend();
    await dsp.flush.inflight;
    await waitUntil(() => dsp.pendingWrites.size === 0);
    expect(dsp.pendingWrites.size).toBe(0);     // released on settle
    expect(isInFlight.current).toBe(false);
  });
});

describe('resync guard sees the bulk lane (Finding 1)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    dsp.pendingWrites = new SvelteSet();
    dsp.flush.inflight = null;
    dsp.flush.currentRev = 0;
    dsp.flush.lastSentRev = 0;
  });
  afterEach(() => { vi.useRealTimers(); bindDevice(null); setStatus('idle'); });

  it('a trailing resync does not clobber an in-flight bulk edit', async () => {
    let resolveSend!: () => void;
    bindBulkDevice(() => new Promise<void>((res) => { resolveSend = res; }));
    commitBulk((s) => { s.masterVolumeDb = -12; });   // optimistic; send parked in flight
    expect(dsp.live?.masterVolumeDb).toBe(-12);
    const { scheduleResync } = await import('./resync');
    scheduleResync();
    await vi.advanceTimersByTimeAsync(300);            // trailing fetch fires (~250ms)
    expect(dsp.live?.masterVolumeDb).toBe(-12);        // guard saw the token: not reverted
    resolveSend();
    await dsp.flush.inflight;
  });
});
