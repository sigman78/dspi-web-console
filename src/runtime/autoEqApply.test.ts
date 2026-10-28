import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { applyAutoEqEntry, preampTargetLabel } from './autoEqApply';
import * as State from '@/state';
import { parseBulkParams } from '@/protocol';
import { fromBulkParams } from '@/protocol/snapshotCodec';
import { createHardwareProfile, FilterType, PlatformType, type AutoEqEntry } from '@/domain';
import { deriveCapabilities } from '@/protocol/capabilities';
import { makeBulk } from '@test/fixtures/bulkFixtures';
import type { DspDevice } from '@/device/DspDevice';

const testHardware = createHardwareProfile(PlatformType.RP2350);

function initializedDevice(methods: Partial<DspDevice>): DspDevice {
  const capabilities = deriveCapabilities(
    { fw: { major: 1, minor: 1, patch: 5 }, wireVersion: 28, payloadLength: 5944, platformId: 1 },
  );
  const base: Partial<DspDevice> = {
    info: {
      serial: 'TEST-RP2350',
      platformType: PlatformType.RP2350,
      hardware: testHardware,
      capabilities,
      build: null,
    },
    capabilities,
    hardware: testHardware,
  };
  return { ...base, ...methods } as DspDevice;
}

const liveMirror = () => State.activeSession()!.mirror;
const cancelWrites = () => { const s = State.activeSession(); if (s) s.writes.cancel(); };

const flatEntry = (preamp: number): AutoEqEntry => ({
  id: 'x', manufacturer: 'X', model: '', source: 'user', formFactor: 'custom', preamp, filters: [],
});

afterEach(() => {
  State.activeSession()?.dispose();
  cancelWrites();
  State.resetAppState();
  vi.useRealTimers();
});

function harness(methods: Partial<DspDevice> = {}) {
  const bulk = parseBulkParams(makeBulk());
  const device = initializedDevice({
    setFilter: vi.fn(async () => {}),
    setInputPreamp: vi.fn(async () => {}),
    setOutputGain: vi.fn(async () => {}),
    getAllParams: vi.fn(async () => parseBulkParams(makeBulk())),
    ...methods,
  });
  State.dispatch({ t: 'synced', id: State.mintConnId(), session: State.makeReadySession(device) });
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
    applyAutoEqEntry(State.activeSession()!, inputId, entry);
    await vi.runAllTimersAsync();
    expect(device.setFilter).toHaveBeenCalledTimes(10);
    expect(device.setInputPreamp).toHaveBeenCalledWith(0, -4);
    expect(device.setOutputGain).not.toHaveBeenCalled();
  });

  it('routes preamp to setOutputGain (output trim) for an output channel', async () => {
    const device = harness();
    const out = liveMirror().current!.outputs[0];
    applyAutoEqEntry(State.activeSession()!, out.id, flatEntry(-2));
    await vi.runAllTimersAsync();
    expect(device.setOutputGain).toHaveBeenCalledWith(out.wireIndex, -2);
    expect(device.setInputPreamp).not.toHaveBeenCalled();
  });

  it('applies to every member of a locked group', async () => {
    const device = harness();
    const out = liveMirror().current!.outputs[0];
    const s = State.activeSession()!;
    s.eqLink.setLocked(out.id, true);
    applyAutoEqEntry(s, out.id, flatEntry(-3));
    await vi.runAllTimersAsync();
    expect(device.setFilter).toHaveBeenCalledTimes(20);
    expect(device.setOutputGain).toHaveBeenCalledTimes(2);
  });

  it('touches only the target while its group is unlocked', async () => {
    const device = harness();
    const out = liveMirror().current!.outputs[0];
    applyAutoEqEntry(State.activeSession()!, out.id, flatEntry(0));
    await vi.runAllTimersAsync();
    expect(device.setFilter).toHaveBeenCalledTimes(10);
    expect(device.setOutputGain).toHaveBeenCalledTimes(1);
  });

  it('does not touch a channel with no group beyond the target itself', async () => {
    const device = harness();
    const pdmId = liveMirror().current!.channels.find((c) => c.shortName === 'PDM')!.id;
    const s = State.activeSession()!;
    s.eqLink.setLocked(pdmId, true);
    applyAutoEqEntry(s, pdmId, flatEntry(0));
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

  it('passes first-order bands through to the wire', async () => {
    const device = harness();
    const inputId = liveMirror().current!.channels.find((c) => !c.isOutput)!.id;
    applyAutoEqEntry(State.activeSession()!, inputId, firstOrderEntry());
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
