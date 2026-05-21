import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SvelteSet } from 'svelte/reactivity';
import { parseBulkParams } from '@/protocol';
import { makeBulk } from '@test/fixtures/bulkFixtures';
import { PlatformType, fromBulkParams, createHardwareProfile } from '@/domain';
import type { DspDevice } from '@/device/DspDevice';
import { bindDevice, session, setStatus, dsp, applyDspSnapshot } from '@/state';
import { commitBulk } from './commit';

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
  session.capabilities = { setAllParams: true, perItemMasterVolume: true, loudnessCrossfeedLeveller: true, i2sConfig: true };
  setStatus('connected');
}

describe('commitBulk', () => {
  beforeEach(() => { dsp.pendingWrites = new SvelteSet(); });
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
    resolveSend();
    await Promise.resolve(); await Promise.resolve();
    await dsp.flush.inflight;
    expect(sends).toBe(2);
  });

  it('on send failure sets error status and clears inflight', async () => {
    bindBulkDevice(async () => { throw new Error('wire fail'); });
    commitBulk((s) => { s.masterVolumeDb = -5; });
    await dsp.flush.inflight?.catch(() => {});
    await Promise.resolve();
    expect(session.status).toBe('error');
    expect(dsp.flush.inflight).toBeNull();
  });

  it('is a no-op when capabilities.setAllParams is false', async () => {
    let sends = 0;
    bindBulkDevice(async () => { sends += 1; });
    session.capabilities = { ...session.capabilities, setAllParams: false };
    commitBulk((s) => { s.masterVolumeDb = -9; });
    expect(dsp.live?.masterVolumeDb).toBe(-9);
    await dsp.flush.inflight;
    expect(sends).toBe(0);
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
});
