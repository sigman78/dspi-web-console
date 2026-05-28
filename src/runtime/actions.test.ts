import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setMasterVolume, toggleMute, attachTransportListeners, setEqFilter, setMasterPreamp, setInputPreamp, copyEqBands, setChannelName, setMasterVolumeMode, saveMasterVolumeBaseline, setBypass, setCrosspointGain, setCrossfeedPreset, setLevellerSpeed, setLevellerAmount, setOutputDelay, setOutputEnabled, setOutputMuted, setCrosspointEnabled, setCrosspointInvert, setOutputDataPin, setOutputType, setI2sBckPin, setMckEnabled } from './actions';
import { session, bindDevice, settings, dsp, status as statusStore, presets, applyBaselineSnapshot, applyDraftSnapshot, resetDsp } from '@/state';
import { bootMock } from './session';
import type { DspTransport, TransportEvent } from '@/transport/DspTransport';
import type { DspDevice } from '@/device/DspDevice';
import { parseBulkParams } from '@/protocol';
import { makeBulk } from '@test/fixtures/bulkFixtures';
import {
  FilterType,
  PlatformType,
  createHardwareProfile,
  type ChannelId,
  MasterVolumeMode,
  CrossfeedPreset,
  LevellerSpeed,
} from '@/domain';
import { fromBulkParams, toBulkParams } from '@/device/snapshotCodec';

import { cancel as cancelWrites, flush as flushWrites, awaitBulkSettled } from './outbox';
import { beginConnection, connectionScope, endConnection } from './connectionScope';

const testHardware = createHardwareProfile(PlatformType.RP2350);

// Builds a DspDevice stub mirroring the real one: applyBulk overlays the draft
// onto the last-fetched wire packet via toBulkParams and forwards to setAllParams
// (which tests spy on). hasState defaults true. Any method can be overridden.
function initializedDevice(methods: Partial<DspDevice>): DspDevice {
  const base: Partial<DspDevice> = {
    info: {
      serial: 'TEST-RP2350',
      firmwareVersion: '1.0.0',
      platformType: PlatformType.RP2350,
      hardware: testHardware,
    },
    hardware: testHardware,
    hasState: true,
  };
  const stub = { ...base, ...methods } as DspDevice & {
    getAllParams?: () => Promise<import('@/protocol').BulkParams>;
    setAllParams?: (b: import('@/protocol').BulkParams) => Promise<void>;
  };
  // Default applyBulk (overlay draft + forward to setAllParams) unless supplied.
  if (!('applyBulk' in methods)) {
    (stub as { applyBulk?: (draft: import('@/domain').DspSnapshot) => Promise<void> }).applyBulk =
      async (draft) => {
        const baseBulk = await stub.getAllParams!();
        const wire = toBulkParams(testHardware, draft, baseBulk);
        await stub.setAllParams!(wire);
      };
  }
  return stub;
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

// Module-scoped state leaks across tests in this file and must be reset after
// every test, or it poisons a later test under a shuffled run order:
//   - the rAF polling loop started by bootMock → finishConnection → startPolling.
//     poll's tick() re-arms requestAnimationFrame unconditionally; with fake
//     timers faking rAF, a later vi.runAllTimersAsync() churns it forever and
//     aborts with "10000 timers, assuming an infinite loop". endConnection() ends it.
//   - the outbox's granular-lane registry + bulk-flush coordination /
//     dsp.pendingWrites. cancelWrites() clears lanes, resets the bulk
//     flush, and drops tokens.
afterEach(() => { endConnection(); cancelWrites(); });

describe('actions wiring', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // reset module-scope settings state used by toggleMute
    settings.soft.muted = false;
    settings.soft.mutedFromDb = null;
    const bulk = parseBulkParams(makeBulk({ masterVolumeDb: 0 }));
    applyDraftSnapshot(fromBulkParams(createHardwareProfile(PlatformType.RP2350), bulk));
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
    // Mirror production wiring: the connection scope owns the transport
    // listeners and the command-cancel disposer (registered in
    // finishConnection). endConnection() — fired by the disconnect handler —
    // disposes them, which is what drops the pending coalescer write.
    beginConnection();
    connectionScope()!.add(attachTransportListeners(transport));
    connectionScope()!.add(() => cancelWrites());

    setMasterVolume(-9);                      // queues a write
    transport.emit('disconnect');             // should cancel before timer fires

    await vi.advanceTimersByTimeAsync(100);
    await vi.runAllTimersAsync();

    expect(calls).toEqual([]);                // pending coalescer dropped
    expect(session.status).toBe('disconnected');
    expect(statusStore.streaming).toBe(false);
  });

  it('beginConnection disposes the prior scope, removing its transport listeners', () => {
    const t1 = new FakeTransport();
    const t2 = new FakeTransport();

    // Self-cleaning now lives in the ConnectionScope: each connect opens a
    // fresh scope (disposing the previous one), and the previous scope holds
    // the disposer returned by attachTransportListeners.
    beginConnection();
    connectionScope()!.add(attachTransportListeners(t1));
    expect(t1.listenerCount('disconnect')).toBe(1);
    expect(t1.listenerCount('connect')).toBe(1);

    beginConnection();                        // disposes the t1 scope
    connectionScope()!.add(attachTransportListeners(t2));
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

  it('copyEqBands copies all bands into the snapshot in N granular operations', () => {
    // copyEqBands enqueues N independent granular writes (one per band).
    const validBulk = parseBulkParams(makeBulk());
    const device = initializedDevice({
      setAllParams: vi.fn(async () => {}),
      getAllParams: vi.fn(async () => validBulk),
    });
    bindDevice(device);

    const sourceId = dsp.draft!.channels[0].id;
    const targetId = dsp.draft!.channels[1].id;
    // Snapshot optimistically updated immediately (no timers needed).
    copyEqBands(sourceId, targetId);

    const tgt = dsp.draft!.channels.find((c) => c.id === targetId)!;
    const src = dsp.draft!.channels.find((c) => c.id === sourceId)!;
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
    applyDraftSnapshot(fromBulkParams(createHardwareProfile(PlatformType.RP2350), bulk));
  });
  afterEach(() => {
    vi.useRealTimers();
    bindDevice(null);
  });

  it('patches the snapshot optimistically', () => {
    // setEqFilter updates dsp.draft immediately; the whole state is written via
    // setAllParams in one bulk packet.
    setEqFilter(0, 1, { type: FilterType.Peaking, frequency: 2000, q: 1, gain: 3 });
    expect(dsp.draft?.channels[0].filters[1].frequency).toBe(2000);
    expect(dsp.draft?.channels[0].filters[1].type).toBe(FilterType.Peaking);
    expect(dsp.draft?.channels[0].filters[1].gain).toBe(3);
  });

  it('rapid edits to the same band converge to the last value in the snapshot', () => {
    // The bulk strategy mutates dsp.draft in-place each call; the snapshot always
    // holds the latest value regardless of how many calls were made.
    for (let f = 100; f <= 1000; f += 100) {
      setEqFilter(0, 1, { type: FilterType.Peaking, frequency: f, q: 1, gain: 0 });
    }
    expect(dsp.draft?.channels[0].filters[1].frequency).toBe(1000);
  });

  it('edits to different bands are all reflected in the snapshot', () => {
    setEqFilter(0, 0, { type: FilterType.Peaking, frequency: 100, q: 1, gain: 0 });
    setEqFilter(0, 1, { type: FilterType.Peaking, frequency: 200, q: 1, gain: 0 });
    setEqFilter(0, 2, { type: FilterType.Peaking, frequency: 300, q: 1, gain: 0 });
    expect(dsp.draft?.channels[0].filters[0].frequency).toBe(100);
    expect(dsp.draft?.channels[0].filters[1].frequency).toBe(200);
    expect(dsp.draft?.channels[0].filters[2].frequency).toBe(300);
  });

  it('throws on out-of-range band and leaves snapshot unchanged', () => {
    const before = { ...dsp.draft!.channels[0].filters[1] };
    const n = dsp.draft!.channels[0].filters.length;
    expect(() => setEqFilter(0, n, { type: FilterType.Peaking, frequency: 9999, q: 1, gain: 12 })).toThrow();
    // Snapshot must not have changed for the valid band.
    expect(dsp.draft?.channels[0].filters[1]).toEqual(before);
  });
});

describe('setMasterPreamp', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    const bulk = parseBulkParams(makeBulk());
    applyDraftSnapshot(fromBulkParams(createHardwareProfile(PlatformType.RP2350), bulk));
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
    expect(dsp.draft?.masterPreampDb).toBe(-3);
    await vi.runAllTimersAsync();
    expect(setMasterPreampFn).toHaveBeenCalledWith(-3);
  });
});

describe('setInputPreamp', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    const bulk = parseBulkParams(makeBulk());
    applyDraftSnapshot(fromBulkParams(createHardwareProfile(PlatformType.RP2350), bulk));
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
    expect(dsp.draft?.inputPreampDb).toEqual([-2, -4]);
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
    applyDraftSnapshot(fromBulkParams(createHardwareProfile(PlatformType.RP2350), bulk));
  });
  afterEach(() => {
    vi.useRealTimers();
    bindDevice(null);
  });

  it('optimistically patches dsp.draft.channels[i].name', () => {
    // setChannelName patches the snapshot; the name rides the next setAllParams.
    setChannelName(0 satisfies ChannelId, 'Studio Left');
    expect(dsp.draft!.channels[0].name).toBe('Studio Left');
  });

  it('treats empty input as a clear: optimistic snapshot falls back to defaultName', () => {
    setChannelName(0 satisfies ChannelId, '');
    const ch = dsp.draft!.channels[0];
    expect(ch.name).toBe(ch.defaultName);
  });

  it('trims whitespace-only input the same as empty', () => {
    setChannelName(0 satisfies ChannelId, '   ');
    const ch = dsp.draft!.channels[0];
    expect(ch.name).toBe(ch.defaultName);
  });

  it('is a no-op when dsp.draft is null', () => {
    resetDsp();
    // Should not throw.
    expect(() => setChannelName(0 satisfies ChannelId, 'X')).not.toThrow();
  });

  it('trims whitespace and stores the resolved value in the snapshot', () => {
    setChannelName(0 satisfies ChannelId, '  padded  ');
    expect(dsp.draft!.channels[0].name).toBe('padded'); // resolved (trimmed)
  });

  it('also patches dsp.draft.outputs[i].name when the channel is an output', () => {
    // ChannelId.Out1L = 2; corresponding outputs[] entry has wireIndex 0.
    setChannelName(2 satisfies ChannelId, 'Front Left');

    // Both arrays must be in sync immediately (no resync wait).
    const channel = dsp.draft!.channels.find((c) => c.id === 2);
    const output = dsp.draft!.outputs.find((o) => o.wireIndex === 0);
    expect(channel?.name).toBe('Front Left');
    expect(output?.name).toBe('Front Left');
  });

  it('patches RP2040 PDM output name at compact output slot 4', () => {
    applyDraftSnapshot(makeSnapshot(PlatformType.RP2040));

    setChannelName(10 satisfies ChannelId, 'Sub');

    const channel = dsp.draft!.channels.find((c) => c.id === 10);
    const output = dsp.draft!.outputs.find((o) => o.wireIndex === 4);
    expect(channel?.name).toBe('Sub');
    expect(output?.name).toBe('Sub');
    expect(dsp.draft!.outputs.some((o) => o.wireIndex === 8)).toBe(false);
  });

  it('does not touch outputs[] when renaming an input channel', () => {
    const outputsBefore = dsp.draft!.outputs.map((o) => o.name).slice();

    // ChannelId.In1L = 0 — no entry in outputs[].
    setChannelName(0 satisfies ChannelId, 'Mic 1');

    const outputsAfter = dsp.draft!.outputs.map((o) => o.name);
    expect(outputsAfter).toEqual(outputsBefore);
  });
});

describe('finishConnection — baseline hydrate', () => {
  beforeEach(async () => {
    await bootMock('rp2350');
  });

  it('finishConnection retains a wire packet in the device (hasState)', async () => {
    expect(session.device!.hasState).toBe(true);
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

describe('bulk writes: toggles', () => {
  let captured: import('@/protocol').BulkParams | null;
  beforeEach(async () => {
    captured = null;
    await bootMock('rp2350');
    const bulk = parseBulkParams(makeBulk());
    bindDevice(initializedDevice({
      setAllParams: vi.fn(async (b) => { captured = b; }),
      getAllParams: vi.fn(async () => bulk),
    }));
    applyBaselineSnapshot(fromBulkParams(testHardware, bulk));
    session.status = 'connected';
  });

  it('setBypass schedules a wire write and patches the snapshot', async () => {
    vi.useFakeTimers();
    const setBypassFn = vi.fn(async () => {});
    bindDevice(initializedDevice({
      setBypass: setBypassFn,
      getAllParams: vi.fn(async () => parseBulkParams(makeBulk())),
    }));

    setBypass(true);
    expect(dsp.draft?.bypass).toBe(true);
    await vi.runAllTimersAsync();
    expect(setBypassFn).toHaveBeenCalledWith(true);
    vi.useRealTimers();
  });

  it('setOutputMuted flips the slot and schedules a granular write', async () => {
    vi.useFakeTimers();
    const setOutputMuteFn = vi.fn(async () => {});
    bindDevice(initializedDevice({
      setOutputMute: setOutputMuteFn,
      getAllParams: vi.fn(async () => parseBulkParams(makeBulk())),
    }));
    const slot = dsp.draft!.outputs[0].wireIndex;
    const before = dsp.draft!.outputs[0].muted;
    setOutputMuted(slot, !before);
    expect(dsp.draft?.outputs.find((o) => o.wireIndex === slot)?.muted).toBe(!before);
    await vi.runAllTimersAsync();
    expect(setOutputMuteFn).toHaveBeenCalledWith(slot, !before);
    vi.useRealTimers();
  });
});

describe('granular writes: enums', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    const bulk = parseBulkParams(makeBulk());
    applyDraftSnapshot(fromBulkParams(createHardwareProfile(PlatformType.RP2350), bulk));
  });
  afterEach(() => { vi.useRealTimers(); bindDevice(null); });

  it('setCrossfeedPreset schedules a granular write and patches the snapshot', async () => {
    const setCrossfeedPresetFn = vi.fn(async () => {});
    const device = initializedDevice({
      setCrossfeedPreset: setCrossfeedPresetFn,
      getAllParams: vi.fn(async () => parseBulkParams(makeBulk())),
    });
    bindDevice(device);
    const target = CrossfeedPreset.Preset2;
    setCrossfeedPreset(target);
    expect(dsp.draft?.crossfeed.preset).toBe(target);
    await vi.runAllTimersAsync();
    expect(setCrossfeedPresetFn).toHaveBeenCalledWith(target);
  });

  it('setLevellerSpeed schedules a granular write and patches the snapshot', async () => {
    const setLevellerSpeedFn = vi.fn(async () => {});
    const device = initializedDevice({
      setLevellerSpeed: setLevellerSpeedFn,
      getAllParams: vi.fn(async () => parseBulkParams(makeBulk())),
    });
    bindDevice(device);
    const target = LevellerSpeed.Fast;
    setLevellerSpeed(target);
    expect(dsp.draft?.leveller?.speed).toBe(target);
    await vi.runAllTimersAsync();
    expect(setLevellerSpeedFn).toHaveBeenCalledWith(target);
  });
});

describe('bulk writes (debounced): sliders', () => {
  let captured: import('@/protocol').BulkParams | null;
  beforeEach(async () => {
    captured = null;
    await bootMock('rp2350');
    const bulk = parseBulkParams(makeBulk());
    bindDevice(initializedDevice({
      setAllParams: vi.fn(async (b) => { captured = b; }),
      getAllParams: vi.fn(async () => bulk),
    }));
    applyBaselineSnapshot(fromBulkParams(testHardware, bulk));
    session.status = 'connected';
  });

  it('setLevellerAmount applies optimistically and flushes via flushWrites', async () => {
    setLevellerAmount(33);
    expect(dsp.draft?.leveller?.amount).toBe(33);
    await flushWrites();
    expect(captured?.leveller.amount).toBe(33);
  });
});

describe('bulk writes: eq/delay/names', () => {
  let captured: import('@/protocol').BulkParams | null;
  beforeEach(async () => {
    captured = null;
    await bootMock('rp2350');
    const bulk = parseBulkParams(makeBulk());
    bindDevice(initializedDevice({
      setAllParams: vi.fn(async (b) => { captured = b; }),
      getAllParams: vi.fn(async () => bulk),
    }));
    applyBaselineSnapshot(fromBulkParams(testHardware, bulk));
    session.status = 'connected';
  });


  it('setOutputDelay writes the slot delay into the snapshot and schedules a granular write', async () => {
    vi.useFakeTimers();
    const setOutputDelayFn = vi.fn(async () => {});
    bindDevice(initializedDevice({
      setOutputDelay: setOutputDelayFn,
      getAllParams: vi.fn(async () => parseBulkParams(makeBulk())),
    }));
    const slot = dsp.draft!.outputs[0].wireIndex;
    setOutputDelay(slot, 5);
    const o = dsp.draft!.outputs.find((o) => o.wireIndex === slot)!;
    expect(o.delayMs).toBe(5);
    await vi.runAllTimersAsync();
    expect(setOutputDelayFn).toHaveBeenCalledWith(slot, 5);
    vi.useRealTimers();
  });

  it('setChannelName sets name and mirrors to the denormalized output entry', async () => {
    const outId = dsp.draft!.outputs[0].id; // a channel that DOES have an output entry
    setChannelName(outId, 'Custom');
    await awaitBulkSettled();
    expect(dsp.draft!.channels.find((c) => c.id === outId)!.name).toBe('Custom');
    expect(dsp.draft!.outputs.find((o) => o.id === outId)!.name).toBe('Custom');
  });
});

describe('crosspoint — granular unified lane (Finding 2)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    const bulk = parseBulkParams(makeBulk());
    applyDraftSnapshot(fromBulkParams(createHardwareProfile(PlatformType.RP2350), bulk));
  });
  afterEach(() => { vi.useRealTimers(); bindDevice(null); });

  it('setCrosspointEnabled sends a full setMatrixRoute tuple via the per-item lane', async () => {
    const calls: Array<{ enabled: boolean; invert: boolean; gainDb: number }> = [];
    const device = initializedDevice({
      setMatrixRoute: vi.fn(async (_i: number, _o: number, cp) => { calls.push(cp); }),
      getAllParams: vi.fn(async () => parseBulkParams(makeBulk())),
    });
    bindDevice(device);
    const route = dsp.draft!.routes[0];
    const before = route.enabled;
    setCrosspointEnabled(route.inputIndex, route.outputWireIndex, !before);
    expect(dsp.draft!.routes[0].enabled).toBe(!before);   // optimistic patch
    await vi.runAllTimersAsync();
    expect(calls).toHaveLength(1);
    expect(calls[0].enabled).toBe(!before);
  });

  it('a setCrosspointEnabled and a gain edit on the same cell coalesce into one consistent setMatrixRoute', async () => {
    const calls: Array<{ enabled: boolean; invert: boolean; gainDb: number }> = [];
    const device = initializedDevice({
      setMatrixRoute: vi.fn(async (_i: number, _o: number, cp) => { calls.push(cp); }),
      getAllParams: vi.fn(async () => parseBulkParams(makeBulk())),
    });
    bindDevice(device);
    const route = dsp.draft!.routes[0];
    const beforeEnabled = route.enabled;
    setCrosspointEnabled(route.inputIndex, route.outputWireIndex, !beforeEnabled);
    setCrosspointGain(route.inputIndex, route.outputWireIndex, -6);
    await vi.runAllTimersAsync();
    expect(calls).toHaveLength(1);                 // one coalesced write
    expect(calls[0].enabled).toBe(!beforeEnabled);
    expect(calls[0].gainDb).toBe(-6);
  });

  it('setCrosspointInvert flips invert and the wire tuple reflects it', async () => {
    const calls: Array<{ enabled: boolean; invert: boolean; gainDb: number }> = [];
    const device = initializedDevice({
      setMatrixRoute: vi.fn(async (_i: number, _o: number, cp) => { calls.push(cp); }),
      getAllParams: vi.fn(async () => parseBulkParams(makeBulk())),
    });
    bindDevice(device);
    const route = dsp.draft!.routes[0];
    const before = route.invert;
    setCrosspointInvert(route.inputIndex, route.outputWireIndex, !before);
    await vi.runAllTimersAsync();
    expect(calls).toHaveLength(1);
    expect(calls[0].invert).toBe(!before);
  });
});

describe('granular writes: eqFilter (per-band)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    const bulk = parseBulkParams(makeBulk());
    applyDraftSnapshot(fromBulkParams(createHardwareProfile(PlatformType.RP2350), bulk));
  });
  afterEach(() => { vi.useRealTimers(); bindDevice(null); });

  it('setEqFilter sends one band via setFilter granular lane', async () => {
    const calls: Array<{ channel: number; band: number; filter: FilterParams }> = [];
    const device = initializedDevice({
      setFilter: vi.fn(async (ch: number, band: number, f: FilterParams) => {
        calls.push({ channel: ch, band, filter: f });
      }),
      getAllParams: vi.fn(async () => parseBulkParams(makeBulk())),
    });
    bindDevice(device);
    const ch = dsp.draft!.channels[0].id;
    setEqFilter(ch, 0, { type: FilterType.Peaking, frequency: 1000, q: 1.0, gain: 3 });
    expect(dsp.draft!.channels[0].filters[0].frequency).toBe(1000); // optimistic patch
    await vi.runAllTimersAsync();
    expect(calls).toHaveLength(1);
    expect(calls[0].band).toBe(0);
    expect(calls[0].filter.frequency).toBe(1000);
  });

  it('setEqFilter throws on out-of-range band', () => {
    const ch = dsp.draft!.channels[0].id;
    const n = dsp.draft!.channels[0].filters.length;
    expect(() => setEqFilter(ch, n, { type: FilterType.Peaking, frequency: 1, q: 1, gain: 0 })).toThrow();
  });

  it('copyEqBands sends N independent setFilter calls (one per band)', async () => {
    const device = initializedDevice({
      setFilter: vi.fn(async () => {}),
      getAllParams: vi.fn(async () => parseBulkParams(makeBulk())),
    });
    bindDevice(device);
    const src = dsp.draft!.channels[0].id;
    const tgt = dsp.draft!.channels[1].id;
    const len = Math.min(dsp.draft!.channels.find((c) => c.id === src)!.filters.length,
                         dsp.draft!.channels.find((c) => c.id === tgt)!.filters.length);
    // Edit source first
    setEqFilter(src, 0, { type: FilterType.Peaking, frequency: 2500, q: 2, gain: -4 });
    setEqFilter(src, 1, { type: FilterType.Peaking, frequency: 5000, q: 1.5, gain: 2 });
    await vi.runAllTimersAsync();
    // Reset mock call count for copyEqBands test
    vi.mocked(device.setFilter).mockClear();
    // Now copy to target
    copyEqBands(src, tgt);
    const t = dsp.draft!.channels.find((c) => c.id === tgt)!;
    const s = dsp.draft!.channels.find((c) => c.id === src)!;
    expect(t.filters[0].frequency).toBe(2500); // optimistic patch
    expect(t.filters[1].frequency).toBe(5000);
    expect(s.filters[0].frequency).toBe(2500); // source unchanged
    expect(s.filters[1].frequency).toBe(5000);
    await vi.runAllTimersAsync();
    expect(device.setFilter).toHaveBeenCalledTimes(len); // N independent setFilter calls
    const calls = vi.mocked(device.setFilter).mock.calls;
    expect(calls[0][1]).toBe(0); // band
    expect(calls[0][2].frequency).toBe(2500);
    expect(calls[1][1]).toBe(1); // band
    expect(calls[1][2].frequency).toBe(5000);
  });
});

describe('dual-lane pendingWrites coexistence (Finding 1 + 2)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  // Sends are parked forever here so the tokens are still present at assertion
  // time; the file-scope afterEach (endConnection + cancelWrites) resets the
  // leaked bulk-flush + granular state.
  afterEach(() => { vi.useRealTimers(); bindDevice(null); session.status = 'idle'; });

  it('granular writes on different controls both register in pendingWrites', async () => {
    const bulk = parseBulkParams(makeBulk());
    const device = initializedDevice({
      // Both sends park forever so neither token is released during the test.
      setMatrixRoute: vi.fn(() => new Promise<void>(() => {})),
      setBypass: vi.fn(() => new Promise<void>(() => {})),
      getAllParams: vi.fn(async () => bulk),
    });
    bindDevice(device);
    applyBaselineSnapshot(fromBulkParams(testHardware, bulk));
    session.status = 'connected';

    expect(dsp.pendingWrites.size).toBe(0);
    // Granular: a crosspoint enable-set claims a granular-lane token synchronously on schedule.
    const route = dsp.draft!.routes[0];
    setCrosspointEnabled(route.inputIndex, route.outputWireIndex, !route.enabled);
    expect(dsp.pendingWrites.size).toBe(1);
    // Granular: bypass is now also granular; another granular control claims its own token.
    // Both lanes now coexist, so the resync soft-skip guard (pendingWrites.size > 0) covers both simultaneously.
    setBypass(true);
    expect(dsp.pendingWrites.size).toBe(2);
  });
});

describe('boolean device flags are explicit setters', () => {
  let captured: import('@/protocol').BulkParams | null;
  beforeEach(async () => {
    captured = null;
    await bootMock('rp2350');
    const bulk = parseBulkParams(makeBulk());
    bindDevice(initializedDevice({
      setAllParams: vi.fn(async (b) => { captured = b; }),
      getAllParams: vi.fn(async () => bulk),
    }));
    applyBaselineSnapshot(fromBulkParams(testHardware, bulk));
    session.status = 'connected';
  });

  it('setOutputEnabled(0, false) disables the output', async () => {
    vi.useFakeTimers();
    const setOutputEnableFn = vi.fn(async () => {});
    bindDevice(initializedDevice({
      setOutputEnable: setOutputEnableFn,
      getAllParams: vi.fn(async () => parseBulkParams(makeBulk())),
    }));
    const slot = dsp.draft!.outputs[0].wireIndex;
    setOutputEnabled(slot, false);
    expect(dsp.draft?.outputs.find((o) => o.wireIndex === slot)?.enabled).toBe(false);
    await vi.runAllTimersAsync();
    expect(setOutputEnableFn).toHaveBeenCalledWith(slot, false);
    vi.useRealTimers();
  });

  it('setOutputEnabled(0, true) enables the output', async () => {
    vi.useFakeTimers();
    const setOutputEnableFn = vi.fn(async () => {});
    bindDevice(initializedDevice({
      setOutputEnable: setOutputEnableFn,
      getAllParams: vi.fn(async () => parseBulkParams(makeBulk())),
    }));
    const slot = dsp.draft!.outputs[0].wireIndex;
    // First disable it
    setOutputEnabled(slot, false);
    await vi.runAllTimersAsync();
    // Then explicitly enable
    setOutputEnabled(slot, true);
    expect(dsp.draft?.outputs.find((o) => o.wireIndex === slot)?.enabled).toBe(true);
    await vi.runAllTimersAsync();
    expect(setOutputEnableFn).toHaveBeenLastCalledWith(slot, true);
    vi.useRealTimers();
  });

  it('setOutputMuted(0, true) mutes the output', async () => {
    vi.useFakeTimers();
    const setOutputMuteFn = vi.fn(async () => {});
    bindDevice(initializedDevice({
      setOutputMute: setOutputMuteFn,
      getAllParams: vi.fn(async () => parseBulkParams(makeBulk())),
    }));
    const slot = dsp.draft!.outputs[0].wireIndex;
    setOutputMuted(slot, true);
    expect(dsp.draft?.outputs.find((o) => o.wireIndex === slot)?.muted).toBe(true);
    await vi.runAllTimersAsync();
    expect(setOutputMuteFn).toHaveBeenCalledWith(slot, true);
    vi.useRealTimers();
  });

  it('setOutputMuted(0, false) unmutes the output', async () => {
    vi.useFakeTimers();
    const setOutputMuteFn = vi.fn(async () => {});
    bindDevice(initializedDevice({
      setOutputMute: setOutputMuteFn,
      getAllParams: vi.fn(async () => parseBulkParams(makeBulk())),
    }));
    const slot = dsp.draft!.outputs[0].wireIndex;
    // First mute it
    setOutputMuted(slot, true);
    await vi.runAllTimersAsync();
    // Then explicitly unmute
    setOutputMuted(slot, false);
    expect(dsp.draft?.outputs.find((o) => o.wireIndex === slot)?.muted).toBe(false);
    await vi.runAllTimersAsync();
    expect(setOutputMuteFn).toHaveBeenLastCalledWith(slot, false);
    vi.useRealTimers();
  });

  it('setCrosspointEnabled sets enabled to a specific value (not just toggle)', async () => {
    vi.useFakeTimers();
    const calls: Array<{ enabled: boolean; invert: boolean; gainDb: number }> = [];
    bindDevice(initializedDevice({
      setMatrixRoute: vi.fn(async (_i: number, _o: number, cp) => { calls.push(cp); }),
      getAllParams: vi.fn(async () => parseBulkParams(makeBulk())),
    }));
    const route = dsp.draft!.routes[0];
    const initial = route.enabled;
    setCrosspointEnabled(route.inputIndex, route.outputWireIndex, !initial);
    expect(dsp.draft!.routes[0].enabled).toBe(!initial);
    // Calling with the same value again must not flip it back
    setCrosspointEnabled(route.inputIndex, route.outputWireIndex, !initial);
    expect(dsp.draft!.routes[0].enabled).toBe(!initial);
    await vi.runAllTimersAsync();
    expect(calls.at(-1)!.enabled).toBe(!initial);
    vi.useRealTimers();
  });

  it('setCrosspointInvert sets invert to a specific value (not just toggle)', async () => {
    vi.useFakeTimers();
    const calls: Array<{ enabled: boolean; invert: boolean; gainDb: number }> = [];
    bindDevice(initializedDevice({
      setMatrixRoute: vi.fn(async (_i: number, _o: number, cp) => { calls.push(cp); }),
      getAllParams: vi.fn(async () => parseBulkParams(makeBulk())),
    }));
    const route = dsp.draft!.routes[0];
    const initial = route.invert;
    setCrosspointInvert(route.inputIndex, route.outputWireIndex, !initial);
    expect(dsp.draft!.routes[0].invert).toBe(!initial);
    // Calling with the same value again must not flip it back
    setCrosspointInvert(route.inputIndex, route.outputWireIndex, !initial);
    expect(dsp.draft!.routes[0].invert).toBe(!initial);
    await vi.runAllTimersAsync();
    expect(calls.at(-1)!.invert).toBe(!initial);
    vi.useRealTimers();
  });
});

describe('output config verbs', () => {
  beforeEach(async () => {
    await bootMock('rp2350');
  });

  it('setOutputDataPin success patches draft.outputPins without discarding other edits', async () => {
    const before = dsp.draft!.masterVolumeDb;
    const r = await setOutputDataPin(0, 16);
    expect(r.ok).toBe(true);
    expect(dsp.draft!.outputPins[0]).toBe(16);
    expect(dsp.draft!.masterVolumeDb).toBe(before);
  });

  it('setOutputDataPin failure leaves outputPins unchanged', async () => {
    // pin 7 is in use by pinOutputIndex 1 — mock returns PinInUse
    const pinsBefore = dsp.draft!.outputPins.slice();
    const r = await setOutputDataPin(0, 7);
    expect(r.ok).toBe(false);
    expect(dsp.draft!.outputPins).toEqual(pinsBefore);
  });

  it('setOutputType updates draft.i2s.outputSlotTypes', async () => {
    const r = await setOutputType(0, 1);
    expect(r.ok).toBe(true);
    expect(dsp.draft!.i2s!.outputSlotTypes[0]).toBe(1);
  });

  test('setI2sBckPin success patches draft.i2s.bckPin', async () => {
    const r = await setI2sBckPin(16);
    expect(r.ok).toBe(true);
    expect(dsp.draft!.i2s!.bckPin).toBe(16);
  });

  test('setMckEnabled success patches draft.i2s.mckEnabled', async () => {
    const r = await setMckEnabled(true);
    expect(r.ok).toBe(true);
    expect(dsp.draft!.i2s!.mckEnabled).toBe(true);
  });
});
