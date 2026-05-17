import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setMasterVolume, toggleMute, attachTransportListeners, setEqFilter, setMasterPreamp, setInputPreamp, copyEqBands, setChannelName, setMasterVolumeMode, saveMasterVolumeBaseline } from './actions';
import { session, bindDevice, settings, dsp, status as statusStore, presets } from '@/state';
import { bootMock } from './session';
import type { DspTransport, TransportEvent } from '@/transport/DspTransport';
import type { DspDevice } from '@/device/DspDevice';
import { parseBulkParams } from '@/protocol';
import { synthesizeBulkParams } from '@/protocol/syn';
import {
  FilterType,
  PlatformType,
  fromBulkParams,
  createHardwareProfile,
  type ChannelId,
  MasterVolumeMode,
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
  const validBulk = parseBulkParams(synthesizeBulkParams({ formatVersion: 6 }));
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
  const validBulk = parseBulkParams(synthesizeBulkParams({ formatVersion: 6 }));
  const device = initializedDevice({
    setChannelName: vi.fn(async (id: number, name: string) => { calls.push({ id, name }); }),
    getAllParams: vi.fn(async () => validBulk),
  });
  return { device, calls };
}

function makeSnapshot(platform: PlatformType = PlatformType.RP2350) {
  const bulk = parseBulkParams(synthesizeBulkParams({
    platformId: platform === PlatformType.RP2350 ? 1 : 0,
    formatVersion: 6,
  }));
  return fromBulkParams(createHardwareProfile(platform), bulk);
}

describe('actions wiring', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // reset module-scope settings state used by toggleMute
    settings.soft.muted = false;
    settings.soft.mutedFromDb = null;
    const bulk = parseBulkParams(synthesizeBulkParams({ formatVersion: 6, masterVolumeDb: 0 }));
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

  it('copyEqBands sends one batched wire burst with one pending token', async () => {
    const validBulk = parseBulkParams(synthesizeBulkParams({ formatVersion: 6 }));
    const filterCalls: Array<[ChannelId, number]> = [];
    let pendingDuringSend = -1;
    const device = initializedDevice({
      setFilter: vi.fn(async (ch: ChannelId, band: number) => {
        if (pendingDuringSend < 0) pendingDuringSend = dsp.pendingWrites.size;
        filterCalls.push([ch, band]);
      }),
      getAllParams: vi.fn(async () => validBulk),
    });
    bindDevice(device);

    const sourceId = dsp.live!.channels[0].id;
    const targetId = dsp.live!.channels[1].id;
    copyEqBands(sourceId, targetId);
    await vi.runAllTimersAsync();

    expect(filterCalls.length).toBeGreaterThan(0);
    expect(filterCalls.every(([ch]) => ch === targetId)).toBe(true);
    expect(pendingDuringSend).toBe(1); // one token across all bands
    expect(dsp.pendingWrites.size).toBe(0);
  });
});

describe('setEqFilter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    const bulk = parseBulkParams(synthesizeBulkParams({ formatVersion: 6 }));
    dsp.live = fromBulkParams(createHardwareProfile(PlatformType.RP2350), bulk);
  });
  afterEach(() => {
    vi.useRealTimers();
    bindDevice(null);
  });

  it('schedules a wire write and patches the snapshot', async () => {
    const setFilter = vi.fn(async () => {});
    const device = initializedDevice({
      setFilter,
      getAllParams: vi.fn(async () => parseBulkParams(synthesizeBulkParams({ formatVersion: 6 }))),
    });
    bindDevice(device);

    setEqFilter(0, 1, { type: FilterType.Peaking, frequency: 2000, q: 1, gain: 3 });
    expect(dsp.live?.channels[0].filters[1].frequency).toBe(2000);
    await vi.runAllTimersAsync();
    expect(setFilter).toHaveBeenCalledWith(0, 1, expect.objectContaining({ frequency: 2000 }));
  });

  it('coalesces rapid edits to the same band', async () => {
    const setFilter = vi.fn(async () => {});
    const device = initializedDevice({
      setFilter,
      getAllParams: vi.fn(async () => parseBulkParams(synthesizeBulkParams({ formatVersion: 6 }))),
    });
    bindDevice(device);

    for (let f = 100; f <= 1000; f += 100) {
      setEqFilter(0, 1, { type: FilterType.Peaking, frequency: f, q: 1, gain: 0 });
    }
    await vi.runAllTimersAsync();
    expect(setFilter).toHaveBeenCalledTimes(1);
    expect(setFilter).toHaveBeenLastCalledWith(0, 1, expect.objectContaining({ frequency: 1000 }));
  });

  it('does not collapse edits to different bands', async () => {
    const setFilter = vi.fn(async () => {});
    const device = initializedDevice({
      setFilter,
      getAllParams: vi.fn(async () => parseBulkParams(synthesizeBulkParams({ formatVersion: 6 }))),
    });
    bindDevice(device);

    setEqFilter(0, 0, { type: FilterType.Peaking, frequency: 100, q: 1, gain: 0 });
    setEqFilter(0, 1, { type: FilterType.Peaking, frequency: 200, q: 1, gain: 0 });
    setEqFilter(0, 2, { type: FilterType.Peaking, frequency: 300, q: 1, gain: 0 });
    await vi.runAllTimersAsync();
    expect(setFilter).toHaveBeenCalledTimes(3);
  });

  it('snapshot converges to truth on send failure', async () => {
    // No rollback in the new pipeline -- forceResyncNow() refetches device
    // truth and applies it. Here the synthesized validBulk's filter equals
    // the pre-edit `before` value, so convergence and rollback would look
    // identical; the assertion is on the convergence outcome, not the path.
    const setFilter = vi.fn(async () => { throw new Error('range'); });
    const device = initializedDevice({
      setFilter,
      getAllParams: vi.fn(async () => parseBulkParams(synthesizeBulkParams({ formatVersion: 6 }))),
    });
    bindDevice(device);

    const before = { ...dsp.live!.channels[0].filters[1] };
    setEqFilter(0, 1, { type: FilterType.Peaking, frequency: 9999, q: 1, gain: 12 });
    await vi.runAllTimersAsync();
    await Promise.resolve();
    expect(dsp.live?.channels[0].filters[1]).toEqual(before);
  });
});

describe('setMasterPreamp', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    const bulk = parseBulkParams(synthesizeBulkParams({ formatVersion: 6 }));
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
      getAllParams: vi.fn(async () => parseBulkParams(synthesizeBulkParams({ formatVersion: 6 }))),
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
    const bulk = parseBulkParams(synthesizeBulkParams({ formatVersion: 6 }));
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
      getAllParams: vi.fn(async () => parseBulkParams(synthesizeBulkParams({ formatVersion: 6 }))),
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
      getAllParams: vi.fn(async () => parseBulkParams(synthesizeBulkParams({ formatVersion: 6 }))),
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
    const bulk = parseBulkParams(synthesizeBulkParams({ formatVersion: 6 }));
    dsp.live = fromBulkParams(createHardwareProfile(PlatformType.RP2350), bulk);
  });
  afterEach(() => {
    vi.useRealTimers();
    bindDevice(null);
  });

  it('optimistically patches dsp.live.channels[i].name and dispatches the wire write', async () => {
    const { device, calls } = makeFakeChannelNameDevice();
    bindDevice(device);

    setChannelName(0 satisfies ChannelId, 'Studio Left');

    expect(dsp.live!.channels[0].name).toBe('Studio Left');

    await vi.runAllTimersAsync();
    expect(calls).toEqual([{ id: 0, name: 'Studio Left' }]);
  });

  it('treats empty input as a clear: optimistic snapshot falls back to defaultName', async () => {
    const { device } = makeFakeChannelNameDevice();
    bindDevice(device);

    setChannelName(0 satisfies ChannelId, '');

    const ch = dsp.live!.channels[0];
    expect(ch.name).toBe(ch.defaultName);
  });

  it('trims whitespace-only input the same as empty', async () => {
    const { device } = makeFakeChannelNameDevice();
    bindDevice(device);

    setChannelName(0 satisfies ChannelId, '   ');

    const ch = dsp.live!.channels[0];
    expect(ch.name).toBe(ch.defaultName);
  });

  it('is a no-op when dsp.live is null', async () => {
    const { device, calls } = makeFakeChannelNameDevice();
    bindDevice(device);
    dsp.live = null;

    setChannelName(0 satisfies ChannelId, 'X');

    await vi.runAllTimersAsync();
    expect(calls).toEqual([]);
  });

  it('sends the raw input on the wire while the optimistic patch holds the resolved value', async () => {
    // Verifies the trimming/resolution is a display concern only — the
    // wire payload preserves the user's literal input so the firmware
    // (and its UTF-8 truncation) sees exactly what was typed.
    const { device, calls } = makeFakeChannelNameDevice();
    bindDevice(device);

    setChannelName(0 satisfies ChannelId, '  padded  ');

    expect(dsp.live!.channels[0].name).toBe('padded'); // resolved (trimmed)

    await vi.runAllTimersAsync();
    expect(calls).toEqual([{ id: 0, name: '  padded  ' }]); // raw
  });

  it('also patches dsp.live.outputs[i].name when the channel is an output', async () => {
    const { device } = makeFakeChannelNameDevice();
    bindDevice(device);

    // ChannelId.Out1L = 2; corresponding outputs[] entry has wireIndex 0.
    setChannelName(2 satisfies ChannelId, 'Front Left');

    // Both arrays must be in sync immediately (no resync wait).
    const channel = dsp.live!.channels.find((c) => c.id === 2);
    const output = dsp.live!.outputs.find((o) => o.wireIndex === 0);
    expect(channel?.name).toBe('Front Left');
    expect(output?.name).toBe('Front Left');
  });

  it('patches RP2040 PDM output name at compact output slot 4', async () => {
    dsp.live = makeSnapshot(PlatformType.RP2040);

    setChannelName(10 satisfies ChannelId, 'Sub');

    const channel = dsp.live!.channels.find((c) => c.id === 10);
    const output = dsp.live!.outputs.find((o) => o.wireIndex === 4);
    expect(channel?.name).toBe('Sub');
    expect(output?.name).toBe('Sub');
    expect(dsp.live!.outputs.some((o) => o.wireIndex === 8)).toBe(false);
  });

  it('does not touch outputs[] when renaming an input channel', async () => {
    const { device } = makeFakeChannelNameDevice();
    bindDevice(device);
    const outputsBefore = dsp.live!.outputs.map((o) => o.name).slice();

    // ChannelId.In1L = 0 — no entry in outputs[].
    setChannelName(0 satisfies ChannelId, 'Mic 1');

    const outputsAfter = dsp.live!.outputs.map((o) => o.name);
    expect(outputsAfter).toEqual(outputsBefore);
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
