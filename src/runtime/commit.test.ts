import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SvelteSet } from 'svelte/reactivity';
import { parseBulkParams } from '@/protocol';
import { makeBulk } from '@test/fixtures/bulkFixtures';
import { PlatformType, fromBulkParams, createHardwareProfile } from '@/domain';
import type { DspDevice } from '@/device/DspDevice';
import { bindDevice, session, setStatus, dsp, applyDspSnapshot } from '@/state';
import { commitBulk, commitBulkDebounced } from './commit';
import { cancelAllCommands } from './commands';

const hw = createHardwareProfile(PlatformType.RP2350);

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
