import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setMasterVolume, toggleMute, attachTransportListeners, setEqFilter, setMasterPreamp, setInputPreamp, copyEqBands, setChannelName, setMasterVolumeMode, saveMasterVolumeBaseline, setBypass, toggleOutputMute, toggleCrosspoint, setCrossfeedPreset, setLevellerSpeed, setLevellerAmount, setOutputDelay } from './actions';
import { session, bindDevice, settings, dsp, status as statusStore, presets } from '@/state';
import { bootMock } from './session';
import type { DspTransport, TransportEvent } from '@/transport/DspTransport';
import type { DspDevice } from '@/device/DspDevice';
import { parseBulkParams } from '@/protocol';
import { makeBulk } from '@test/fixtures/bulkFixtures';
import {
  FilterType,
  PlatformType,
  fromBulkParams,
  createHardwareProfile,
  type ChannelId,
  MasterVolumeMode,
  CrossfeedPreset,
  LevellerSpeed,
} from '@/domain';

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

class FakeTransport implements DspTransport {
  #listeners = new Map<TransportEvent, Set<() => void>>();
  async open() {}
  async close() {}
  isOpen() { return true; }
  async ctrlIn() { return new Uint8Array(); }
  async ctrlOut() {}
  on(event: TransportEvent, fn: () => void) {
    let s = this.#listeners.get(event);
    if (!s) { s = new Set(); this.#listeners.set(event, s); }
    s.add(fn);
    return () => s!.delete(fn);
  }
  emit(event: TransportEvent) {
    this.#listeners.get(event)?.forEach((l) => l());
  }
  listenerCount(event: TransportEvent): number {
    return this.#listeners.get(event)?.size ?? 0;
  }
}

function makeFakeDevice() {
  const calls: number[] = [];
  const validBulk = parseBulkParams(makeBulk());
  const device = initializedDevice({
    setMasterVolume: vi.fn(async (db: number) => { calls.push(db); }),
    // Resync's getAllParams runs after every setMasterVolume; resolving
    // with a valid parsed bulk keeps the test's stderr clean.
    getAllParams: vi.fn(async () => validBulk),
  });
  return { device, calls };
}

function makeFakeChannelNameDevice() {
  const calls: { id: number; name: string }[] = [];
  const validBulk = parseBulkParams(makeBulk());
  const device = initializedDevice({
    setChannelName: vi.fn(async (id: number, name: string) => { calls.push({ id, name }); }),
    getAllParams: vi.fn(async () => validBulk),
  });
  return { device, calls };
}

function makeSnapshot(platform: PlatformType = PlatformType.RP2350) {
  const bulk = parseBulkParams(makeBulk(
    { platformId: platform === PlatformType.RP2350 ? 1 : 0 },
  ));
  return fromBulkParams(createHardwareProfile(platform), bulk);
}

describe('actions wiring', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // reset module-scope settings state used by toggleMute
    settings.soft.muted = false;
    settings.soft.mutedFromDb = null;
    const bulk = parseBulkParams(makeBulk({ masterVolumeDb: 0 }));
    dsp.live = fromBulkParams(createHardwareProfile(PlatformType.RP2350), bulk);
  });

  afterEach(() => {
    vi.useRealTimers();
    bindDevice(null);
  });

  it('mute lands as the final wire write even with a slider value pending', async () => {
    const { device, calls } = makeFakeDevice();
    bindDevice(device);

    setMasterVolume(-12);    // queues -12 in the coalescer
    toggleMute();             // queues -128 (MUTE_DB), overwriting -12

    await vi.advanceTimersByTimeAsync(50);   // flush the trailing-edge timer
    await vi.runAllTimersAsync();

    expect(settings.soft.muted).toBe(true);
    expect(calls.at(-1)).toBe(-128);          // mute is the last value on the wire
    expect(calls).not.toContain(-12);        // the slider value was coalesced away
  });

  it('disconnect cancels pending coalescer + resync and resets state', async () => {
    const { device, calls } = makeFakeDevice();
    const transport = new FakeTransport();
    bindDevice(device);
    attachTransportListeners(transport);

    setMasterVolume(-9);                      // queues a write
    transport.emit('disconnect');             // should cancel before timer fires

    await vi.advanceTimersByTimeAsync(100);
    await vi.runAllTimersAsync();

    expect(calls).toEqual([]);                // pending coalescer dropped
    expect(session.status).toBe('disconnected');
    expect(statusStore.streaming).toBe(false);
  });

  it('attachTransportListeners is self-cleaning on re-register', () => {
    const t1 = new FakeTransport();
    const t2 = new FakeTransport();

    attachTransportListeners(t1);
    expect(t1.listenerCount('disconnect')).toBe(1);
    expect(t1.listenerCount('connect')).toBe(1);

    attachTransportListeners(t2);
    // t1 listeners removed, t2 listeners attached
    expect(t1.listenerCount('disconnect')).toBe(0);
    expect(t1.listenerCount('connect')).toBe(0);
    expect(t2.listenerCount('disconnect')).toBe(1);
    expect(t2.listenerCount('connect')).toBe(1);
  });

  it('bindDevice bumps session.generation each call', () => {
    const { device } = makeFakeDevice();
    const before = session.generation;
    bindDevice(device);
    expect(session.generation).toBe(before + 1);
    bindDevice(null);
    expect(session.generation).toBe(before + 2);
  });

  it('copyEqBands copies all bands into the snapshot in one operation', () => {
    // Under commitBulk, copyEqBands no longer calls setFilter per-band.
    // It writes the full snapshot in one bulk operation.
    const validBulk = parseBulkParams(makeBulk());
    const device = initializedDevice({
      setAllParams: vi.fn(async () => {}),
      getAllParams: vi.fn(async () => validBulk),
    });
    bindDevice(device);

    const sourceId = dsp.live!.channels[0].id;
    const targetId = dsp.live!.channels[1].id;
    // Snapshot optimistically updated immediately (no timers needed).
    copyEqBands(sourceId, targetId);

    const tgt = dsp.live!.channels.find((c) => c.id === targetId)!;
    const src = dsp.live!.channels.find((c) => c.id === sourceId)!;
    // All bands should match source.
    for (let i = 0; i < Math.min(src.filters.length, tgt.filters.length); i++) {
      expect(tgt.filters[i]).toEqual(src.filters[i]);
    }
  });
});

describe('setEqFilter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    const bulk = parseBulkParams(makeBulk());
    dsp.live = fromBulkParams(createHardwareProfile(PlatformType.RP2350), bulk);
  });
  afterEach(() => {
    vi.useRealTimers();
    bindDevice(null);
  });

  it('patches the snapshot optimistically', () => {
    // Under commitBulk, setEqFilter updates dsp.live immediately; no
    // per-band setFilter calls are made — the whole state is written via
    // setAllParams in one bulk packet.
    setEqFilter(0, 1, { type: FilterType.Peaking, frequency: 2000, q: 1, gain: 3 });
    expect(dsp.live?.channels[0].filters[1].frequency).toBe(2000);
    expect(dsp.live?.channels[0].filters[1].type).toBe(FilterType.Peaking);
    expect(dsp.live?.channels[0].filters[1].gain).toBe(3);
  });

  it('rapid edits to the same band converge to the last value in the snapshot', () => {
    // commitBulk mutates dsp.live in-place each call; the snapshot always
    // holds the latest value regardless of how many calls were made.
    for (let f = 100; f <= 1000; f += 100) {
      setEqFilter(0, 1, { type: FilterType.Peaking, frequency: f, q: 1, gain: 0 });
    }
    expect(dsp.live?.channels[0].filters[1].frequency).toBe(1000);
  });

  it('edits to different bands are all reflected in the snapshot', () => {
    setEqFilter(0, 0, { type: FilterType.Peaking, frequency: 100, q: 1, gain: 0 });
    setEqFilter(0, 1, { type: FilterType.Peaking, frequency: 200, q: 1, gain: 0 });
    setEqFilter(0, 2, { type: FilterType.Peaking, frequency: 300, q: 1, gain: 0 });
    expect(dsp.live?.channels[0].filters[0].frequency).toBe(100);
    expect(dsp.live?.channels[0].filters[1].frequency).toBe(200);
    expect(dsp.live?.channels[0].filters[2].frequency).toBe(300);
  });

  it('throws on out-of-range band and leaves snapshot unchanged', () => {
    const before = { ...dsp.live!.channels[0].filters[1] };
    const n = dsp.live!.channels[0].filters.length;
    expect(() => setEqFilter(0, n, { type: FilterType.Peaking, frequency: 9999, q: 1, gain: 12 })).toThrow();
    // Snapshot must not have changed for the valid band.
    expect(dsp.live?.channels[0].filters[1]).toEqual(before);
  });
});

describe('setMasterPreamp', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    const bulk = parseBulkParams(makeBulk());
    dsp.live = fromBulkParams(createHardwareProfile(PlatformType.RP2350), bulk);
  });
  afterEach(() => {
    vi.useRealTimers();
    bindDevice(null);
  });

  it('schedules a wire write and patches the snapshot', async () => {
    const setMasterPreampFn = vi.fn(async () => {});
    const device = initializedDevice({
      setMasterPreamp: setMasterPreampFn,
      getAllParams: vi.fn(async () => parseBulkParams(makeBulk())),
    });
    bindDevice(device);

    setMasterPreamp(-3);
    expect(dsp.live?.masterPreampDb).toBe(-3);
    await vi.runAllTimersAsync();
    expect(setMasterPreampFn).toHaveBeenCalledWith(-3);
  });
});

describe('setInputPreamp', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    const bulk = parseBulkParams(makeBulk());
    dsp.live = fromBulkParams(createHardwareProfile(PlatformType.RP2350), bulk);
  });
  afterEach(() => {
    vi.useRealTimers();
    bindDevice(null);
  });

  it('patches the correct channel slot and schedules the wire write', async () => {
    const setInputPreampFn = vi.fn(async () => {});
    const device = initializedDevice({
      setInputPreamp: setInputPreampFn,
      getAllParams: vi.fn(async () => parseBulkParams(makeBulk())),
    });
    bindDevice(device);

    setInputPreamp(0, -2);
    setInputPreamp(1, -4);
    expect(dsp.live?.inputPreampDb).toEqual([-2, -4]);
    await vi.runAllTimersAsync();
    expect(setInputPreampFn).toHaveBeenCalledWith(0, -2);
    expect(setInputPreampFn).toHaveBeenCalledWith(1, -4);
  });

  it('coalesces rapid edits to the same channel only', async () => {
    const setInputPreampFn = vi.fn(async () => {});
    const device = initializedDevice({
      setInputPreamp: setInputPreampFn,
      getAllParams: vi.fn(async () => parseBulkParams(makeBulk())),
    });
    bindDevice(device);

    setInputPreamp(0, -1);
    setInputPreamp(0, -2);
    setInputPreamp(0, -3);
    setInputPreamp(1, -10);
    await vi.runAllTimersAsync();
    expect(setInputPreampFn).toHaveBeenCalledTimes(2);
    expect(setInputPreampFn).toHaveBeenCalledWith(0, -3);
    expect(setInputPreampFn).toHaveBeenCalledWith(1, -10);
  });
});

describe('setChannelName', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    const bulk = parseBulkParams(makeBulk());
    dsp.live = fromBulkParams(createHardwareProfile(PlatformType.RP2350), bulk);
  });
  afterEach(() => {
    vi.useRealTimers();
    bindDevice(null);
  });

  it('optimistically patches dsp.live.channels[i].name', () => {
    // Under commitBulk, setChannelName no longer calls d.setChannelName —
    // the name is included in the next setAllParams bulk write instead.
    setChannelName(0 satisfies ChannelId, 'Studio Left');
    expect(dsp.live!.channels[0].name).toBe('Studio Left');
  });

  it('treats empty input as a clear: optimistic snapshot falls back to defaultName', () => {
    setChannelName(0 satisfies ChannelId, '');
    const ch = dsp.live!.channels[0];
    expect(ch.name).toBe(ch.defaultName);
  });

  it('trims whitespace-only input the same as empty', () => {
    setChannelName(0 satisfies ChannelId, '   ');
    const ch = dsp.live!.channels[0];
    expect(ch.name).toBe(ch.defaultName);
  });

  it('is a no-op when dsp.live is null', () => {
    dsp.live = null;
    // Should not throw.
    expect(() => setChannelName(0 satisfies ChannelId, 'X')).not.toThrow();
  });

  it('trims whitespace and stores the resolved value in the snapshot', () => {
    // Under commitBulk the trimmed/resolved name goes into the snapshot;
    // the raw input is NOT preserved separately (no per-item wire call).
    setChannelName(0 satisfies ChannelId, '  padded  ');
    expect(dsp.live!.channels[0].name).toBe('padded'); // resolved (trimmed)
  });

  it('also patches dsp.live.outputs[i].name when the channel is an output', () => {
    // ChannelId.Out1L = 2; corresponding outputs[] entry has wireIndex 0.
    setChannelName(2 satisfies ChannelId, 'Front Left');

    // Both arrays must be in sync immediately (no resync wait).
    const channel = dsp.live!.channels.find((c) => c.id === 2);
    const output = dsp.live!.outputs.find((o) => o.wireIndex === 0);
    expect(channel?.name).toBe('Front Left');
    expect(output?.name).toBe('Front Left');
  });

  it('patches RP2040 PDM output name at compact output slot 4', () => {
    dsp.live = makeSnapshot(PlatformType.RP2040);

    setChannelName(10 satisfies ChannelId, 'Sub');

    const channel = dsp.live!.channels.find((c) => c.id === 10);
    const output = dsp.live!.outputs.find((o) => o.wireIndex === 4);
    expect(channel?.name).toBe('Sub');
    expect(output?.name).toBe('Sub');
    expect(dsp.live!.outputs.some((o) => o.wireIndex === 8)).toBe(false);
  });

  it('does not touch outputs[] when renaming an input channel', () => {
    const outputsBefore = dsp.live!.outputs.map((o) => o.name).slice();

    // ChannelId.In1L = 0 — no entry in outputs[].
    setChannelName(0 satisfies ChannelId, 'Mic 1');

    const outputsAfter = dsp.live!.outputs.map((o) => o.name);
    expect(outputsAfter).toEqual(outputsBefore);
  });
});

describe('finishConnection — baseline hydrate', () => {
  beforeEach(async () => {
    await bootMock('rp2350');
  });

  it('finishConnection populates baselineBulk', async () => {
    expect(dsp.baselineBulk).not.toBeNull();
  });
});

describe('actions — master volume mode', () => {
  beforeEach(async () => {
    await bootMock('rp2350');
  });

  it('setMasterVolumeMode flips the directory cache value', async () => {
    presets.directory = {
      occupiedSlotsSet: new Set(),
      startupMode: 0, defaultSlot: 0 as any, lastActiveSlot: null,
      includePins: false,
      masterVolumeMode: MasterVolumeMode.Independent,
    };
    await setMasterVolumeMode(MasterVolumeMode.WithPreset);
    expect(presets.directory!.masterVolumeMode).toBe(MasterVolumeMode.WithPreset);
  });

  it('saveMasterVolumeBaseline returns ok in Mode 0', async () => {
    presets.directory = {
      occupiedSlotsSet: new Set(),
      startupMode: 0, defaultSlot: 0 as any, lastActiveSlot: null,
      includePins: false,
      masterVolumeMode: MasterVolumeMode.Independent,
    };
    const r = await saveMasterVolumeBaseline();
    expect(r.ok).toBe(true);
  });
});

describe('Tier B → commitBulk: toggles', () => {
  let captured: import('@/protocol').BulkParams | null;
  beforeEach(async () => {
    captured = null;
    await bootMock('rp2350');
    const bulk = parseBulkParams(makeBulk());
    bindDevice(initializedDevice({
      setAllParams: vi.fn(async (b) => { captured = b; }),
      getAllParams: vi.fn(async () => bulk),
    }));
    const { applyDspSnapshot } = await import('@/state');
    applyDspSnapshot(fromBulkParams(testHardware, bulk), bulk);
    session.status = 'connected';
  });

  it('setBypass fires one bulk write carrying the new bypass flag', async () => {
    setBypass(true);
    expect(dsp.live?.bypass).toBe(true);
    await dsp.flush.inflight;
    expect(captured?.bypass).toBe(true);
  });

  it('toggleOutputMute flips the slot and the bulk packet reflects it', async () => {
    const slot = dsp.live!.outputs[0].wireIndex;
    const before = dsp.live!.outputs[0].muted;
    toggleOutputMute(slot);
    await dsp.flush.inflight;
    const wireOut = captured!.outputs[dsp.live!.outputs[0].wireIndex];
    expect(wireOut.muted).toBe(!before);
  });

  it('toggleCrosspoint flips enabled and the bulk packet carries the new tuple', async () => {
    const route = dsp.live!.routes[0];
    const { inputIndex, outputWireIndex } = route;
    const before = route.enabled;
    toggleCrosspoint(inputIndex, outputWireIndex);
    await dsp.flush.inflight;
    expect(captured!.crosspoints[inputIndex][outputWireIndex].enabled).toBe(!before);
  });
});

describe('Tier B → commitBulk: enums', () => {
  let captured: import('@/protocol').BulkParams | null;
  beforeEach(async () => {
    captured = null;
    await bootMock('rp2350');
    const bulk = parseBulkParams(makeBulk());
    bindDevice(initializedDevice({
      setAllParams: vi.fn(async (b) => { captured = b; }),
      getAllParams: vi.fn(async () => bulk),
    }));
    const { applyDspSnapshot } = await import('@/state');
    applyDspSnapshot(fromBulkParams(testHardware, bulk), bulk);
    session.status = 'connected';
  });

  it('setCrossfeedPreset writes the chosen preset into the bulk packet', async () => {
    // Default from makeBulk() is CrossfeedPreset.Preset1 (0); pick Preset2 (1) to assert a change.
    const target = CrossfeedPreset.Preset2;
    setCrossfeedPreset(target);
    await dsp.flush.inflight;
    expect(captured?.crossfeed.preset).toBe(target);
  });

  it('setLevellerSpeed writes the chosen speed into the bulk packet', async () => {
    // Default from makeBulk() is LevellerSpeed.Slow (0); pick Fast (2) to assert a change.
    const target = LevellerSpeed.Fast;
    setLevellerSpeed(target);
    await dsp.flush.inflight;
    expect(captured?.leveller.speed).toBe(target);
  });
});

describe('Tier B → commitBulkDebounced: sliders', () => {
  let captured: import('@/protocol').BulkParams | null;
  beforeEach(async () => {
    captured = null;
    await bootMock('rp2350');
    const bulk = parseBulkParams(makeBulk());
    bindDevice(initializedDevice({
      setAllParams: vi.fn(async (b) => { captured = b; }),
      getAllParams: vi.fn(async () => bulk),
    }));
    const { applyDspSnapshot } = await import('@/state');
    applyDspSnapshot(fromBulkParams(testHardware, bulk), bulk);
    session.status = 'connected';
  });

  it('setLevellerAmount applies optimistically and flushes via flushPending', async () => {
    const { flushPending } = await import('./commit');
    setLevellerAmount(33);
    expect(dsp.live?.leveller?.amount).toBe(33);
    await flushPending();
    expect(captured?.leveller.amount).toBe(33);
  });
});

describe('Tier B → commitBulk: eq/delay/names', () => {
  let captured: import('@/protocol').BulkParams | null;
  beforeEach(async () => {
    captured = null;
    await bootMock('rp2350');
    const bulk = parseBulkParams(makeBulk());
    bindDevice(initializedDevice({
      setAllParams: vi.fn(async (b) => { captured = b; }),
      getAllParams: vi.fn(async () => bulk),
    }));
    const { applyDspSnapshot } = await import('@/state');
    applyDspSnapshot(fromBulkParams(testHardware, bulk), bulk);
    session.status = 'connected';
  });

  it('setEqFilter writes one band into the snapshot and bulk packet', async () => {
    const ch = dsp.live!.channels[0].id;
    setEqFilter(ch, 0, { type: FilterType.Peaking, frequency: 1000, q: 1.0, gain: 3 });
    await dsp.flush.inflight;
    expect(dsp.live!.channels[0].filters[0].frequency).toBe(1000);
    // the bulk packet carries the edited band (at some wire-channel row)
    expect(captured!.filters.some((row) => row[0]?.frequency === 1000)).toBe(true);
  });

  it('setEqFilter throws on out-of-range band', () => {
    const ch = dsp.live!.channels[0].id;
    const n = dsp.live!.channels[0].filters.length;
    expect(() => setEqFilter(ch, n, { type: FilterType.Peaking, frequency: 1, q: 1, gain: 0 })).toThrow();
  });

  it('copyEqBands copies all bands target←source in one bulk write, source unchanged', async () => {
    const src = dsp.live!.channels[0].id;
    const tgt = dsp.live!.channels[1].id;
    setEqFilter(src, 0, { type: FilterType.Peaking, frequency: 2500, q: 2, gain: -4 });
    await dsp.flush.inflight;
    setEqFilter(src, 1, { type: FilterType.Peaking, frequency: 5000, q: 1.5, gain: 2 });
    await dsp.flush.inflight;
    copyEqBands(src, tgt);
    await dsp.flush.inflight;
    const t = dsp.live!.channels.find((c) => c.id === tgt)!;
    const s = dsp.live!.channels.find((c) => c.id === src)!;
    expect(t.filters[0].frequency).toBe(2500);
    expect(t.filters[1].frequency).toBe(5000);
    expect(s.filters[0].frequency).toBe(2500); // source intact
    expect(s.filters[1].frequency).toBe(5000);
  });

  it('setOutputDelay writes the slot delay into the snapshot and bulk packet', async () => {
    const slot = dsp.live!.outputs[0].wireIndex;
    setOutputDelay(slot, 5);
    await dsp.flush.inflight;
    const o = dsp.live!.outputs.find((o) => o.wireIndex === slot)!;
    expect(o.delayMs).toBe(5);
    expect(captured!.outputs[slot].delayMs).toBe(5);
  });

  it('setChannelName sets name and mirrors to the denormalized output entry', async () => {
    const outId = dsp.live!.outputs[0].id; // a channel that DOES have an output entry
    setChannelName(outId, 'Custom');
    await dsp.flush.inflight;
    expect(dsp.live!.channels.find((c) => c.id === outId)!.name).toBe('Custom');
    expect(dsp.live!.outputs.find((o) => o.id === outId)!.name).toBe('Custom');
  });
});
