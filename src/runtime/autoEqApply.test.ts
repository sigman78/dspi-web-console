import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { applyAutoEqEntry, preampTargetLabel } from './autoEqApply';
import { dispatch, makeReadySession, activeSession } from '@/state';
import { parseBulkParams } from '@/protocol';
import { fromBulkParams } from '@/protocol/snapshotCodec';
import { createHardwareProfile, FilterType, PlatformType, type AutoEqEntry } from '@/domain';
import { deriveCapabilities } from '@/protocol/capabilities';
import { makeBulk } from '@test/fixtures/bulkFixtures';
import type { DspDevice } from '@/device/DspDevice';
import { endConnection } from './connectionScope';

const testHardware = createHardwareProfile(PlatformType.RP2350);

function initializedDevice(methods: Partial<DspDevice>, wireVersion: 10 | 16 = 10): DspDevice {
  const capabilities = deriveCapabilities(
    wireVersion === 16
      ? { fw: { major: 1, minor: 1, patch: 5 }, wireVersion: 16, payloadLength: 5864, platformId: 1 }
      : { fw: { major: 1, minor: 1, patch: 4 }, wireVersion: 10, payloadLength: 2960, platformId: 1 },
  );
  const base: Partial<DspDevice> = {
    info: {
      serial: 'TEST-RP2350',
      platformType: PlatformType.RP2350,
      hardware: testHardware,
      capabilities,
    },
    capabilities,
    hardware: testHardware,
  };
  return { ...base, ...methods } as DspDevice;
}

const liveMirror = () => activeSession()!.mirror;
const cancelWrites = () => { const s = activeSession(); if (s) s.writes.cancel(); };

const flatEntry = (preamp: number): AutoEqEntry => ({
  id: 'x', manufacturer: 'X', model: '', source: 'user', formFactor: 'custom', preamp, filters: [],
});

afterEach(() => {
  endConnection();
  cancelWrites();
  dispatch({ t: 'disconnected' });
  vi.useRealTimers();
});

function harness(methods: Partial<DspDevice> = {}, wireVersion: 10 | 16 = 10) {
  const bulk = parseBulkParams(makeBulk());
  const device = initializedDevice({
    setFilter: vi.fn(async () => {}),
    setInputPreamp: vi.fn(async () => {}),
    setOutputGain: vi.fn(async () => {}),
    getAllParams: vi.fn(async () => parseBulkParams(makeBulk())),
    ...methods,
  }, wireVersion);
  dispatch({ t: 'synced', session: makeReadySession(device) });
  liveMirror().replaceCurrent(fromBulkParams(testHardware, bulk));
  return device;
}

describe('applyAutoEqEntry', () => {
  beforeEach(() => { vi.useFakeTimers(); });

  it('writes 10 bands and routes preamp to setInputPreamp for an input channel', async () => {
    const device = harness();
    const inputId = liveMirror().current!.channels.find((c) => !c.isOutput)!.id;
    const entry: AutoEqEntry = {
      ...flatEntry(-4),
      filters: [{ type: 'peaking', freq: 1000, q: 1, gain: 3 }],
    };
    applyAutoEqEntry(activeSession()!, inputId, entry, false);
    await vi.runAllTimersAsync();
    expect(device.setFilter).toHaveBeenCalledTimes(10);
    expect(device.setInputPreamp).toHaveBeenCalledWith(0, -4);
    expect(device.setOutputGain).not.toHaveBeenCalled();
  });

  it('routes preamp to setOutputGain (output trim) for an output channel', async () => {
    const device = harness();
    const out = liveMirror().current!.outputs[0];
    applyAutoEqEntry(activeSession()!, out.id, flatEntry(-2), false);
    await vi.runAllTimersAsync();
    expect(device.setOutputGain).toHaveBeenCalledWith(out.wireIndex, -2);
    expect(device.setInputPreamp).not.toHaveBeenCalled();
  });

  it('applies to the stereo twin too when includePairTwin is true', async () => {
    const device = harness();
    const inputId = liveMirror().current!.channels.find((c) => !c.isOutput)!.id;
    applyAutoEqEntry(activeSession()!, inputId, flatEntry(0), true);
    await vi.runAllTimersAsync();
    expect(device.setFilter).toHaveBeenCalledTimes(20);
    expect(device.setInputPreamp).toHaveBeenCalledTimes(2);
  });

  it('does not touch a channel with no stereo twin beyond the target itself', async () => {
    const device = harness();
    const pdmId = liveMirror().current!.channels.find((c) => c.shortName === 'PDM')!.id;
    applyAutoEqEntry(activeSession()!, pdmId, flatEntry(0), true);
    await vi.runAllTimersAsync();
    expect(device.setFilter).toHaveBeenCalledTimes(10);
  });

  const firstOrderEntry = (): AutoEqEntry => ({
    ...flatEntry(0),
    filters: [
      { type: 'lowShelf1', freq: 200, q: 0.7, gain: 4 },
      { type: 'peaking', freq: 1000, q: 1, gain: 3 },
    ],
  });

  it('flattens first-order bands when the device lacks the firstOrderEq capability', async () => {
    const device = harness({}, 10);
    const inputId = liveMirror().current!.channels.find((c) => !c.isOutput)!.id;
    applyAutoEqEntry(activeSession()!, inputId, firstOrderEntry(), false);
    await vi.runAllTimersAsync();
    const calls = vi.mocked(device.setFilter).mock.calls;
    expect(calls.find((c) => c[1] === 0)![2].type).toBe(FilterType.Flat);
    expect(calls.find((c) => c[1] === 1)![2].type).toBe(FilterType.Peaking);
  });

  it('passes first-order bands through on a firstOrderEq-capable device', async () => {
    const device = harness({}, 16);
    const inputId = liveMirror().current!.channels.find((c) => !c.isOutput)!.id;
    applyAutoEqEntry(activeSession()!, inputId, firstOrderEntry(), false);
    await vi.runAllTimersAsync();
    const calls = vi.mocked(device.setFilter).mock.calls;
    expect(calls.find((c) => c[1] === 0)![2].type).toBe(FilterType.LowShelf1);
  });
});

describe('preampTargetLabel', () => {
  it('distinguishes input and output channels', () => {
    expect(preampTargetLabel({ isOutput: false })).toBe('INPUT PREAMP');
    expect(preampTargetLabel({ isOutput: true })).toBe('OUTPUT TRIM');
  });
});
