import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as link from './eqLinkActions';
import { dispatch, mintConnId, makeReadySession, activeSession, resetAppState } from '@/state';
import { parseBulkParams } from '@/protocol';
import { fromBulkParams } from '@/protocol/snapshotCodec';
import { deriveCapabilities } from '@/protocol/capabilities';
import { AudioInputSource, createHardwareProfile, defaultFilter, ChannelId, FilterType, PlatformType } from '@/domain';
import { makeBulk } from '@test/fixtures/bulkFixtures';
import type { DspDevice } from '@/device/DspDevice';

const hardware = createHardwareProfile(PlatformType.RP2350);
const L = ChannelId.Out1L;
const R = ChannelId.Out1R;

function harness() {
  const bulk = parseBulkParams(makeBulk());
  const capabilities = deriveCapabilities({
    fw: { major: 1, minor: 1, patch: 4 }, wireVersion: 10, payloadLength: 2960, platformId: 1,
  });
  const device = {
    info: { serial: 'TEST-LINK', platformType: PlatformType.RP2350, hardware, capabilities, build: null },
    capabilities,
    hardware,
    setFilter: vi.fn(async () => {}),
    setBandBypass: vi.fn(async () => {}),
    setCrossoverBand: vi.fn(async () => {}),
    setCrossoverBypass: vi.fn(async () => {}),
    setInputPreamp: vi.fn(async () => {}),
    setOutputGain: vi.fn(async () => {}),
    setOutputDelay: vi.fn(async () => {}),
    getAllParams: vi.fn(async () => parseBulkParams(makeBulk())),
  } as unknown as DspDevice;
  dispatch({ t: 'synced', id: mintConnId(), session: makeReadySession(device) });
  const s = activeSession()!;
  s.mirror.replaceCurrent(fromBulkParams(hardware, bulk));
  return { s, device };
}

const ch = (id: ChannelId) => activeSession()!.mirror.current!.channels.find((c) => c.id === id)!;
const settle = () => vi.runAllTimersAsync();

beforeEach(() => { localStorage.clear(); vi.useFakeTimers(); });
afterEach(() => {
  const s = activeSession();
  s?.dispose();
  s?.writes.cancel();
  resetAppState();
  vi.useRealTimers();
});

describe('linked verbs', () => {
  it('write to every member while locked', async () => {
    const { s, device } = harness();
    s.eqLink.setLocked(L, true);
    link.setEqFilterLinked(s, L, 2, { ...defaultFilter(), type: FilterType.Peaking, gain: 3 });
    link.setBandBypassLinked(s, R, 4, true);
    await settle();
    expect(vi.mocked(device.setFilter).mock.calls.map((c) => [c[0], c[1]])).toEqual([[L, 2], [R, 2]]);
    expect(vi.mocked(device.setBandBypass).mock.calls.map((c) => c[0]).sort()).toEqual([L, R]);
    expect(ch(R).filters[2].gain).toBe(3);
    expect(ch(L).filters[4].bypass).toBe(true);
  });

  it('write only to the channel while unlocked', async () => {
    const { s, device } = harness();
    link.setEqFilterLinked(s, L, 0, { ...defaultFilter(), gain: 1 });
    link.setOutputGainLinked(s, L, -2);
    link.setOutputDelayLinked(s, L, 1);
    await settle();
    expect(device.setFilter).toHaveBeenCalledTimes(1);
    expect(device.setOutputGain).toHaveBeenCalledTimes(1);
    expect(device.setOutputDelay).toHaveBeenCalledTimes(1);
  });

  it('fan out output gain and delay by wire index', async () => {
    const { s, device } = harness();
    s.eqLink.setLocked(L, true);
    link.setOutputGainLinked(s, L, -2);
    link.setOutputDelayLinked(s, R, 1);
    await settle();
    const outs = s.mirror.current!.outputs;
    const slots = [L, R].map((id) => outs.find((o) => o.id === id)!.wireIndex);
    expect(vi.mocked(device.setOutputGain).mock.calls.map((c) => c[0])).toEqual(slots);
    expect(vi.mocked(device.setOutputDelay).mock.calls.map((c) => c[0])).toEqual(slots);
  });

  it('fan out input preamp across a locked input group', async () => {
    const { s, device } = harness();
    s.mirror.current!.inputConfig.source = AudioInputSource.Spdif;
    s.eqLink.setLocked(ChannelId.In1L, true);
    link.setInputPreampLinked(s, ChannelId.In1L, -4);
    await settle();
    expect(vi.mocked(device.setInputPreamp).mock.calls.map((c) => c[0])).toEqual([0, 1]);
  });

  it('paste onto a locked group skips the source member', async () => {
    const { s, device } = harness();
    s.eqLink.setLocked(L, true);
    link.pasteEqLinked(s, L, R);
    await settle();
    expect(vi.mocked(device.setFilter).mock.calls.every((c) => c[0] === R)).toBe(true);
    expect(device.setFilter).toHaveBeenCalledTimes(10);
  });

  it('skip members that lack crossover bands', async () => {
    const { s, device } = harness();
    s.eqLink.setLocked(L, true);
    ch(L).xoverBands = [defaultFilter()];
    ch(R).xoverBands = [];
    link.setXoverBandLinked(s, L, 0, { ...defaultFilter(), type: FilterType.Lr4Lp });
    link.setXoverBypassLinked(s, R, 0, true);
    await settle();
    expect(vi.mocked(device.setCrossoverBand).mock.calls.map((c) => c[0])).toEqual([L]);
    expect(device.setCrossoverBypass).toHaveBeenCalledTimes(1);
    expect(vi.mocked(device.setCrossoverBypass).mock.calls[0][0]).toBe(L);
  });
});

describe('syncEqLinkFrom', () => {
  it('writes only the items that differ', async () => {
    const { s, device } = harness();
    ch(L).filters[1] = { ...defaultFilter(), type: FilterType.Peaking, gain: 5 };
    ch(L).filters[2] = { ...defaultFilter(), bypass: true };
    s.mirror.current!.outputs.find((o) => o.id === L)!.delayMs = 2;
    link.syncEqLinkFrom(s, L);
    await settle();
    expect(vi.mocked(device.setFilter).mock.calls.map((c) => [c[0], c[1]])).toEqual([[R, 1]]);
    expect(vi.mocked(device.setBandBypass).mock.calls.map((c) => [c[0], c[1], c[2]])).toEqual([[R, 2, true]]);
    expect(device.setOutputDelay).toHaveBeenCalledTimes(1);
    expect(device.setOutputGain).not.toHaveBeenCalled();
  });

  it('copies the input preamp onto the grouped input peer only when it differs', async () => {
    const { s, device } = harness();
    s.mirror.current!.inputConfig.source = AudioInputSource.Spdif;
    s.mirror.current!.inputPreampDb[0] = -6;
    s.mirror.current!.inputPreampDb[1] = 0;
    link.syncEqLinkFrom(s, ChannelId.In1L);
    await settle();
    expect(vi.mocked(device.setInputPreamp).mock.calls.map((c) => [c[0], c[1]])).toEqual([[1, -6]]);
    link.syncEqLinkFrom(s, ChannelId.In1L);
    await settle();
    expect(device.setInputPreamp).toHaveBeenCalledTimes(1);
  });

  it('copies crossover bands only over the common length', async () => {
    const { s, device } = harness();
    ch(L).xoverBands = [
      { ...defaultFilter(), type: FilterType.Lr4Lp, frequency: 100 },
      { ...defaultFilter(), type: FilterType.Lr4Lp, frequency: 200 },
      { ...defaultFilter(), type: FilterType.Lr4Lp, frequency: 300 },
    ];
    ch(R).xoverBands = [defaultFilter(), defaultFilter()];
    link.syncEqLinkFrom(s, L);
    await settle();
    expect(vi.mocked(device.setCrossoverBand).mock.calls.map((c) => [c[0], c[1]])).toEqual([[R, 0], [R, 1]]);
  });

  it('runs on lock and the lock flips both ways', async () => {
    const { s, device } = harness();
    ch(L).filters[0] = { ...defaultFilter(), type: FilterType.Peaking, gain: 2 };
    link.setEqLinkLocked(s, L, true);
    await settle();
    expect(s.eqLink.isLocked(R)).toBe(true);
    expect(device.setFilter).toHaveBeenCalledTimes(1);
    link.setEqLinkLocked(s, L, false);
    expect(s.eqLink.isLocked(R)).toBe(false);
  });
});
