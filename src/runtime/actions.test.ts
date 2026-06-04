import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setMasterVolume, toggleMute, setEqFilter, setMasterPreamp, setInputPreamp, copyEqBands, setChannelName, setMasterVolumeMode, saveMasterVolumeBaseline, setBypass, setCrosspointGain, setCrossfeedPreset, setLevellerSpeed, setLevellerAmount, setOutputDelay, setOutputGain, setOutputEnabled, setOutputMuted, setCrosspointEnabled, setCrosspointInvert, setOutputDataPin, setOutputType, setI2sBckPin, setMckEnabled, setLoudnessEnabled, setLoudnessRefSpl, setLoudnessIntensityPct } from './actions';
import { attachTransportListeners, factoryResetDevice } from './actionsDevice';
import { connection, settings, presets, notices, clearNotices, dispatch, makeReadySession, activeSession } from '@/state';
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
  type FilterParams,
  MasterVolumeMode,
  CrossfeedPreset,
  LevellerSpeed,
} from '@/domain';
import { fromBulkParams } from '@/device/snapshotCodec';
import { deriveCapabilities } from '@/device/capabilities';

import { cancelAllWrites as cancelWrites, flushAllWrites } from './writes';
import { beginConnection, connectionScope, endConnection } from './connectionScope';

const testHardware = createHardwareProfile(PlatformType.RP2350);

// Builds a DspDevice stub with identity defaults. Any method can be overridden.
function initializedDevice(methods: Partial<DspDevice>): DspDevice {
  const base: Partial<DspDevice> = {
    info: {
      serial: 'TEST-RP2350',
      platformType: PlatformType.RP2350,
      hardware: testHardware,
      capabilities: deriveCapabilities({
        fw: { major: 1, minor: 1, patch: 3 }, wireVersion: 6, payloadLength: 2896, platformId: 1,
      }),
    },
    hardware: testHardware,
  };
  return { ...base, ...methods } as DspDevice;
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

function makeSnapshot(platform: PlatformType = PlatformType.RP2350) {
  const bulk = parseBulkParams(makeBulk(
    { platformId: platform === PlatformType.RP2350 ? 1 : 0 },
  ));
  return fromBulkParams(createHardwareProfile(platform), bulk);
}

// Module-scoped state leaks across tests in this file and must be reset after
// every test, or it poisons a later test under a shuffled run order:
//   - the rAF polling loop started by bootMock → wireUpConnection → startPolling.
//     poll's tick() re-arms requestAnimationFrame unconditionally; with fake
//     timers faking rAF, a later vi.runAllTimersAsync() churns it forever and
//     aborts with "10000 timers, assuming an infinite loop". endConnection() ends it.
//   - device/writes scrub-lane registry + inflight counter.
//     cancelWrites() (alias for cancelAllWrites) clears lanes and drops tokens.
afterEach(() => { endConnection(); cancelWrites(); dispatch({ t: 'disconnected' }); });

// Each beforeEach/test installs a ready session (dispatch synced) BEFORE touching
// the mirror, so this resolves the active session's MirrorState — the same
// instance the deleted `mirror` forwarder used to proxy to.
const liveMirror = () => activeSession()!.mirror;

describe('actions wiring', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // reset module-scope settings state used by toggleMute
    settings.soft.muted = false;
    settings.soft.mutedFromDb = null;
    const bulk = parseBulkParams(makeBulk({ masterVolumeDb: 0 }));
    dispatch({ t: 'synced', session: makeReadySession({} as never) });
    liveMirror().replaceCurrent(fromBulkParams(createHardwareProfile(PlatformType.RP2350), bulk));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('mute lands as the final wire write even with a slider value pending', async () => {
    const { device, calls } = makeFakeDevice();
    dispatch({ t: 'synced', session: makeReadySession(device) });
    liveMirror().replaceCurrent(fromBulkParams(createHardwareProfile(PlatformType.RP2350), parseBulkParams(makeBulk({ masterVolumeDb: 0 }))));

    setMasterVolume(activeSession()!, -12);    // queues -12 in the coalescer
    toggleMute(activeSession()!);              // queues -128 (MUTE_DB), overwriting -12

    await vi.advanceTimersByTimeAsync(50);   // flush the trailing-edge timer
    await vi.runAllTimersAsync();

    expect(settings.soft.muted).toBe(true);
    expect(calls.at(-1)).toBe(-128);          // mute is the last value on the wire
    expect(calls).not.toContain(-12);        // the slider value was coalesced away
  });

  it('disconnect cancels pending coalescer + resync and resets state', async () => {
    const { device, calls } = makeFakeDevice();
    dispatch({ t: 'synced', session: makeReadySession(device) });
    liveMirror().replaceCurrent(fromBulkParams(createHardwareProfile(PlatformType.RP2350), parseBulkParams(makeBulk({ masterVolumeDb: 0 }))));
    const transport = new FakeTransport();
    // Mirror production wiring: the connection scope owns the transport
    // listeners and the command-cancel disposer (registered in
    // wireUpConnection). endConnection() — fired by the disconnect handler —
    // disposes them, which is what drops the pending coalescer write.
    beginConnection();
    connectionScope()!.add(attachTransportListeners(transport, device));
    connectionScope()!.add(() => cancelWrites());

    setMasterVolume(activeSession()!, -9);    // queues a write
    transport.emit('disconnect');             // should cancel before timer fires

    await vi.advanceTimersByTimeAsync(100);
    await vi.runAllTimersAsync();

    expect(calls).toEqual([]);                // pending coalescer dropped
    expect(connection.phase).toBe('noDevice');
    expect(activeSession()).toBeNull();       // session (and its telemetry) dropped
  });

  it('beginConnection disposes the prior scope, removing its transport listeners', () => {
    const t1 = new FakeTransport();
    const t2 = new FakeTransport();

    // Self-cleaning now lives in the ConnectionScope: each connect opens a
    // fresh scope (disposing the previous one), and the previous scope holds
    // the disposer returned by attachTransportListeners.
    beginConnection();
    connectionScope()!.add(attachTransportListeners(t1, {} as DspDevice));
    expect(t1.listenerCount('disconnect')).toBe(1);
    expect(t1.listenerCount('connect')).toBe(1);

    beginConnection();                        // disposes the t1 scope
    connectionScope()!.add(attachTransportListeners(t2, {} as DspDevice));
    // t1 listeners removed, t2 listeners attached
    expect(t1.listenerCount('disconnect')).toBe(0);
    expect(t1.listenerCount('connect')).toBe(0);
    expect(t2.listenerCount('disconnect')).toBe(1);
    expect(t2.listenerCount('connect')).toBe(1);
  });

  it('copyEqBands copies all bands into the snapshot in N granular operations', async () => {
    // copyEqBands issues N independent write() calls (one per band); snapshot
    // is updated after each send acks (await-then-mutate).
    const validBulk = parseBulkParams(makeBulk());
    const device = initializedDevice({
      setFilter: vi.fn(async () => {}),
      getAllParams: vi.fn(async () => validBulk),
    });
    dispatch({ t: 'synced', session: makeReadySession(device) });
    liveMirror().replaceCurrent(fromBulkParams(createHardwareProfile(PlatformType.RP2350), parseBulkParams(makeBulk())));

    const sourceId = liveMirror().current!.channels[0].id;
    const targetId = liveMirror().current!.channels[1].id;
    copyEqBands(activeSession()!, sourceId, targetId);
    // Flush microtasks so the async sends resolve and mutates apply.
    await vi.runAllTimersAsync();

    const tgt = liveMirror().current!.channels.find((c) => c.id === targetId)!;
    const src = liveMirror().current!.channels.find((c) => c.id === sourceId)!;
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
    const device = initializedDevice({
      setFilter: vi.fn(async () => {}),
      getAllParams: vi.fn(async () => parseBulkParams(makeBulk())),
    });
    dispatch({ t: 'synced', session: makeReadySession(device) });
    liveMirror().replaceCurrent(fromBulkParams(createHardwareProfile(PlatformType.RP2350), bulk));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('patches the snapshot after send acks', async () => {
    // setEqFilter awaits the wire send, then mutates draft (await-then-mutate).
    setEqFilter(activeSession()!, 0, 1, { type: FilterType.Peaking, bypass: false, frequency: 2000, q: 1, gain: 3 });
    await vi.runAllTimersAsync();
    expect(liveMirror().current?.channels[0].filters[1].frequency).toBe(2000);
    expect(liveMirror().current?.channels[0].filters[1].type).toBe(FilterType.Peaking);
    expect(liveMirror().current?.channels[0].filters[1].gain).toBe(3);
  });

  it('rapid edits to the same band each apply independently (no coalescing)', async () => {
    // Each write() call is independent; the snapshot holds the last applied value.
    for (let f = 100; f <= 1000; f += 100) {
      setEqFilter(activeSession()!, 0, 1, { type: FilterType.Peaking, bypass: false, frequency: f, q: 1, gain: 0 });
    }
    await vi.runAllTimersAsync();
    expect(liveMirror().current?.channels[0].filters[1].frequency).toBe(1000);
  });

  it('sequential partial edits to a band compose via the settled mirror', async () => {
    const calls: FilterParams[] = [];
    const device = initializedDevice({
      setFilter: vi.fn(async (_ch: number, _band: number, f: FilterParams) => { calls.push({ ...f }); }),
      getAllParams: vi.fn(async () => parseBulkParams(makeBulk())),
    });
    dispatch({ t: 'synced', session: makeReadySession(device) });
    liveMirror().replaceCurrent(fromBulkParams(createHardwareProfile(PlatformType.RP2350), parseBulkParams(makeBulk())));
    // Edit frequency, let it settle, then edit gain built from the updated band
    // (the same {...current, ...patch} merge BandRow performs on commit).
    setEqFilter(activeSession()!, 0, 1, { ...liveMirror().current!.channels[0].filters[1], frequency: 2000 });
    await vi.runAllTimersAsync();
    setEqFilter(activeSession()!, 0, 1, { ...liveMirror().current!.channels[0].filters[1], gain: 4 });
    await vi.runAllTimersAsync();

    expect(calls).toHaveLength(2);
    expect(calls[1].frequency).toBe(2000);   // gain edit carried the settled frequency
    expect(calls[1].gain).toBe(4);
    expect(liveMirror().current?.channels[0].filters[1].frequency).toBe(2000);
    expect(liveMirror().current?.channels[0].filters[1].gain).toBe(4);
  });

  it('edits to different bands are all reflected in the snapshot', async () => {
    setEqFilter(activeSession()!, 0, 0, { type: FilterType.Peaking, bypass: false, frequency: 100, q: 1, gain: 0 });
    setEqFilter(activeSession()!, 0, 1, { type: FilterType.Peaking, bypass: false, frequency: 200, q: 1, gain: 0 });
    setEqFilter(activeSession()!, 0, 2, { type: FilterType.Peaking, bypass: false, frequency: 300, q: 1, gain: 0 });
    await vi.runAllTimersAsync();
    expect(liveMirror().current?.channels[0].filters[0].frequency).toBe(100);
    expect(liveMirror().current?.channels[0].filters[1].frequency).toBe(200);
    expect(liveMirror().current?.channels[0].filters[2].frequency).toBe(300);
  });

  it('throws on out-of-range band and leaves snapshot unchanged', async () => {
    const before = { ...liveMirror().current!.channels[0].filters[1] };
    const n = liveMirror().current!.channels[0].filters.length;
    expect(() => setEqFilter(activeSession()!, 0, n, { type: FilterType.Peaking, bypass: false, frequency: 9999, q: 1, gain: 12 })).toThrow();
    await vi.runAllTimersAsync();
    // Snapshot must not have changed for the valid band.
    expect(liveMirror().current?.channels[0].filters[1]).toEqual(before);
  });
});

describe('setMasterPreamp', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    const bulk = parseBulkParams(makeBulk());
    dispatch({ t: 'synced', session: makeReadySession({} as never) });
    liveMirror().replaceCurrent(fromBulkParams(createHardwareProfile(PlatformType.RP2350), bulk));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('schedules a wire write and patches the snapshot', async () => {
    const setMasterPreampFn = vi.fn(async () => {});
    const device = initializedDevice({
      setMasterPreamp: setMasterPreampFn,
      getAllParams: vi.fn(async () => parseBulkParams(makeBulk())),
    });
    dispatch({ t: 'synced', session: makeReadySession(device) });
    liveMirror().replaceCurrent(fromBulkParams(createHardwareProfile(PlatformType.RP2350), parseBulkParams(makeBulk())));

    setMasterPreamp(activeSession()!, -3);
    expect(liveMirror().current?.masterPreampDb).toBe(-3);
    await vi.runAllTimersAsync();
    expect(setMasterPreampFn).toHaveBeenCalledWith(-3);
  });
});

describe('setInputPreamp', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    const bulk = parseBulkParams(makeBulk());
    dispatch({ t: 'synced', session: makeReadySession({} as never) });
    liveMirror().replaceCurrent(fromBulkParams(createHardwareProfile(PlatformType.RP2350), bulk));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('patches the correct channel slot and schedules the wire write', async () => {
    const setInputPreampFn = vi.fn(async () => {});
    const device = initializedDevice({
      setInputPreamp: setInputPreampFn,
      getAllParams: vi.fn(async () => parseBulkParams(makeBulk())),
    });
    dispatch({ t: 'synced', session: makeReadySession(device) });
    liveMirror().replaceCurrent(fromBulkParams(createHardwareProfile(PlatformType.RP2350), parseBulkParams(makeBulk())));

    setInputPreamp(activeSession()!, 0, -2);
    setInputPreamp(activeSession()!, 1, -4);
    expect(liveMirror().current?.inputPreampDb).toEqual([-2, -4]);
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
    dispatch({ t: 'synced', session: makeReadySession(device) });
    liveMirror().replaceCurrent(fromBulkParams(createHardwareProfile(PlatformType.RP2350), parseBulkParams(makeBulk())));

    setInputPreamp(activeSession()!, 0, -1);
    setInputPreamp(activeSession()!, 0, -2);
    setInputPreamp(activeSession()!, 0, -3);
    setInputPreamp(activeSession()!, 1, -10);
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
    const device = initializedDevice({
      setChannelName: vi.fn(async () => {}),
      getAllParams: vi.fn(async () => parseBulkParams(makeBulk())),
    });
    dispatch({ t: 'synced', session: makeReadySession(device) });
    liveMirror().replaceCurrent(fromBulkParams(createHardwareProfile(PlatformType.RP2350), bulk));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('patches the snapshot channels[i].name after send acks', async () => {
    // setChannelName awaits the wire send, then mutates draft (await-then-mutate).
    setChannelName(activeSession()!, 0 satisfies ChannelId, 'Studio Left');
    await vi.runAllTimersAsync();
    expect(liveMirror().current!.channels[0].name).toBe('Studio Left');
  });

  it('treats empty input as a clear: snapshot falls back to defaultName', async () => {
    const defaultName = liveMirror().current!.channels[0].defaultName;
    setChannelName(activeSession()!, 0 satisfies ChannelId, '');
    await vi.runAllTimersAsync();
    expect(liveMirror().current!.channels[0].name).toBe(defaultName);
  });

  it('trims whitespace-only input the same as empty', async () => {
    const defaultName = liveMirror().current!.channels[0].defaultName;
    setChannelName(activeSession()!, 0 satisfies ChannelId, '   ');
    await vi.runAllTimersAsync();
    expect(liveMirror().current!.channels[0].name).toBe(defaultName);
  });

  it('trims whitespace and stores the resolved value in the snapshot', async () => {
    setChannelName(activeSession()!, 0 satisfies ChannelId, '  padded  ');
    await vi.runAllTimersAsync();
    expect(liveMirror().current!.channels[0].name).toBe('padded'); // resolved (trimmed)
  });

  it('also patches the snapshot outputs[i].name when the channel is an output', async () => {
    // ChannelId.Out1L = 2; corresponding outputs[] entry has wireIndex 0.
    setChannelName(activeSession()!, 2 satisfies ChannelId, 'Front Left');
    await vi.runAllTimersAsync();

    const channel = liveMirror().current!.channels.find((c) => c.id === 2);
    const output = liveMirror().current!.outputs.find((o) => o.wireIndex === 0);
    expect(channel?.name).toBe('Front Left');
    expect(output?.name).toBe('Front Left');
  });

  it('patches RP2040 PDM output name at compact output slot 4', async () => {
    const rp2040Device = initializedDevice({
      setChannelName: vi.fn(async () => {}),
      getAllParams: vi.fn(async () => parseBulkParams(makeBulk())),
    });
    dispatch({ t: 'synced', session: makeReadySession(rp2040Device) });
    liveMirror().replaceCurrent(makeSnapshot(PlatformType.RP2040));

    setChannelName(activeSession()!, 10 satisfies ChannelId, 'Sub');
    await vi.runAllTimersAsync();

    const channel = liveMirror().current!.channels.find((c) => c.id === 10);
    const output = liveMirror().current!.outputs.find((o) => o.wireIndex === 4);
    expect(channel?.name).toBe('Sub');
    expect(output?.name).toBe('Sub');
    expect(liveMirror().current!.outputs.some((o) => o.wireIndex === 8)).toBe(false);
  });

  it('does not touch outputs[] when renaming an input channel', async () => {
    const outputsBefore = liveMirror().current!.outputs.map((o) => o.name).slice();

    // ChannelId.In1L = 0 — no entry in outputs[].
    setChannelName(activeSession()!, 0 satisfies ChannelId, 'Mic 1');
    await vi.runAllTimersAsync();

    const outputsAfter = liveMirror().current!.outputs.map((o) => o.name);
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
    setMasterVolumeMode(activeSession()!, MasterVolumeMode.WithPreset);
    await vi.waitFor(() => expect(presets.directory!.masterVolumeMode).toBe(MasterVolumeMode.WithPreset));
  });

  it('saveMasterVolumeBaseline warns on flash failure and stays silent on success', async () => {
    clearNotices();
    const failDevice = initializedDevice({ saveMasterVolume: async () => false });
    dispatch({ t: 'synced', session: makeReadySession(failDevice) });
    liveMirror().replaceCurrent(fromBulkParams(createHardwareProfile(PlatformType.RP2350), parseBulkParams(makeBulk())));
    saveMasterVolumeBaseline(activeSession()!);
    await flushAllWrites();
    expect(notices.list.some((n) => n.kind === 'warn' && /master volume/i.test(n.message))).toBe(true);

    clearNotices();
    const okDevice = initializedDevice({ saveMasterVolume: async () => true });
    dispatch({ t: 'synced', session: makeReadySession(okDevice) });
    liveMirror().replaceCurrent(fromBulkParams(createHardwareProfile(PlatformType.RP2350), parseBulkParams(makeBulk())));
    saveMasterVolumeBaseline(activeSession()!);
    await flushAllWrites();
    expect(notices.list).toHaveLength(0);
    expect(presets.savedMasterVolumeDb).toBe(liveMirror().current!.masterVolumeDb);
  });
});

describe('bulk writes: toggles', () => {
  beforeEach(async () => {
    await bootMock('rp2350');
    const bulk = parseBulkParams(makeBulk());
    liveMirror().init(fromBulkParams(testHardware, bulk));
  });

  it('setBypass sends a wire write and patches the snapshot after ack', async () => {
    vi.useFakeTimers();
    const setBypassDevice = initializedDevice({
      setBypass: vi.fn(async () => {}),
      getAllParams: vi.fn(async () => parseBulkParams(makeBulk())),
    });
    dispatch({ t: 'synced', session: makeReadySession(setBypassDevice) });
    liveMirror().replaceCurrent(fromBulkParams(createHardwareProfile(PlatformType.RP2350), parseBulkParams(makeBulk())));

    setBypass(activeSession()!, true);
    await vi.runAllTimersAsync();
    expect(setBypassDevice.setBypass).toHaveBeenCalledWith(true);
    expect(liveMirror().current?.bypass).toBe(true);
    vi.useRealTimers();
  });

  it('setOutputMuted sends a write and flips the slot after ack', async () => {
    vi.useFakeTimers();
    const setOutputMuteFn = vi.fn(async () => {});
    const device = initializedDevice({
      setOutputMute: setOutputMuteFn,
      getAllParams: vi.fn(async () => parseBulkParams(makeBulk())),
    });
    dispatch({ t: 'synced', session: makeReadySession(device) });
    liveMirror().replaceCurrent(fromBulkParams(createHardwareProfile(PlatformType.RP2350), parseBulkParams(makeBulk())));
    const slot = liveMirror().current!.outputs[0].wireIndex;
    const before = liveMirror().current!.outputs[0].muted;
    setOutputMuted(activeSession()!, slot, !before);
    await vi.runAllTimersAsync();
    expect(liveMirror().current?.outputs.find((o) => o.wireIndex === slot)?.muted).toBe(!before);
    expect(setOutputMuteFn).toHaveBeenCalledWith(slot, !before);
    vi.useRealTimers();
  });
});

describe('granular writes: enums', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    const bulk = parseBulkParams(makeBulk());
    dispatch({ t: 'synced', session: makeReadySession({} as never) });
    liveMirror().replaceCurrent(fromBulkParams(createHardwareProfile(PlatformType.RP2350), bulk));
  });
  afterEach(() => { vi.useRealTimers(); });

  it('setCrossfeedPreset sends a write and patches the snapshot after ack', async () => {
    const setCrossfeedPresetFn = vi.fn(async () => {});
    const device = initializedDevice({
      setCrossfeedPreset: setCrossfeedPresetFn,
      getAllParams: vi.fn(async () => parseBulkParams(makeBulk())),
    });
    dispatch({ t: 'synced', session: makeReadySession(device) });
    liveMirror().replaceCurrent(fromBulkParams(createHardwareProfile(PlatformType.RP2350), parseBulkParams(makeBulk())));
    const target = CrossfeedPreset.Preset2;
    setCrossfeedPreset(activeSession()!, target);
    await vi.runAllTimersAsync();
    expect(setCrossfeedPresetFn).toHaveBeenCalledWith(target);
    expect(liveMirror().current?.crossfeed.preset).toBe(target);
  });

  it('setLevellerSpeed sends a write and patches the snapshot after ack', async () => {
    const setLevellerSpeedFn = vi.fn(async () => {});
    const device = initializedDevice({
      setLevellerSpeed: setLevellerSpeedFn,
      getAllParams: vi.fn(async () => parseBulkParams(makeBulk())),
    });
    dispatch({ t: 'synced', session: makeReadySession(device) });
    liveMirror().replaceCurrent(fromBulkParams(createHardwareProfile(PlatformType.RP2350), parseBulkParams(makeBulk())));
    const target = LevellerSpeed.Fast;
    setLevellerSpeed(activeSession()!, target);
    await vi.runAllTimersAsync();
    expect(setLevellerSpeedFn).toHaveBeenCalledWith(target);
    expect(liveMirror().current?.leveller?.speed).toBe(target);
  });
});

describe('granular writes (numeric sliders): sliders', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    const bulk = parseBulkParams(makeBulk());
    dispatch({ t: 'synced', session: makeReadySession({} as never) });
    liveMirror().replaceCurrent(fromBulkParams(createHardwareProfile(PlatformType.RP2350), bulk));
  });
  afterEach(() => { vi.useRealTimers(); });

  it('setLevellerAmount applies optimistically and sends via granular lane', async () => {
    const setLevellerAmountFn = vi.fn(async () => {});
    const device = initializedDevice({
      setLevellerAmount: setLevellerAmountFn,
      getAllParams: vi.fn(async () => parseBulkParams(makeBulk())),
    });
    dispatch({ t: 'synced', session: makeReadySession(device) });
    liveMirror().replaceCurrent(fromBulkParams(createHardwareProfile(PlatformType.RP2350), parseBulkParams(makeBulk())));
    setLevellerAmount(activeSession()!, 33);
    expect(liveMirror().current?.leveller?.amount).toBe(33);
    await vi.runAllTimersAsync();
    expect(setLevellerAmountFn).toHaveBeenCalledWith(33);
  });
});

describe('loudness verbs — capability-pass (CD3)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('setLoudnessEnabled sends a write and patches the snapshot after ack', async () => {
    const setLoudnessEnabledFn = vi.fn(async () => {});
    const device = initializedDevice({
      setLoudnessEnabled: setLoudnessEnabledFn,
      getAllParams: vi.fn(async () => parseBulkParams(makeBulk())),
    });
    const bulk = parseBulkParams(makeBulk());
    dispatch({ t: 'synced', session: makeReadySession(device) });
    liveMirror().replaceCurrent(fromBulkParams(createHardwareProfile(PlatformType.RP2350), bulk));
    setLoudnessEnabled(activeSession()!, true);
    await vi.runAllTimersAsync();
    expect(setLoudnessEnabledFn).toHaveBeenCalledWith(true);
    expect(liveMirror().current?.loudness.enabled).toBe(true);
  });

  it('setLoudnessRefSpl applies optimistically and sends via granular lane', async () => {
    const setLoudnessRefSplFn = vi.fn(async () => {});
    const device = initializedDevice({
      setLoudnessRefSpl: setLoudnessRefSplFn,
      getAllParams: vi.fn(async () => parseBulkParams(makeBulk())),
    });
    const bulk = parseBulkParams(makeBulk());
    dispatch({ t: 'synced', session: makeReadySession(device) });
    liveMirror().replaceCurrent(fromBulkParams(createHardwareProfile(PlatformType.RP2350), bulk));
    setLoudnessRefSpl(activeSession()!, 90);
    expect(liveMirror().current?.loudness.refSpl).toBe(90);
    await vi.runAllTimersAsync();
    expect(setLoudnessRefSplFn).toHaveBeenCalledWith(90);
  });

  it('setLoudnessIntensityPct applies optimistically and sends via granular lane', async () => {
    const setLoudnessIntensityFn = vi.fn(async () => {});
    const device = initializedDevice({
      setLoudnessIntensity: setLoudnessIntensityFn,
      getAllParams: vi.fn(async () => parseBulkParams(makeBulk())),
    });
    const bulk = parseBulkParams(makeBulk());
    dispatch({ t: 'synced', session: makeReadySession(device) });
    liveMirror().replaceCurrent(fromBulkParams(createHardwareProfile(PlatformType.RP2350), bulk));
    setLoudnessIntensityPct(activeSession()!, 50);
    expect(liveMirror().current?.loudness.intensityPct).toBe(50);
    await vi.runAllTimersAsync();
    expect(setLoudnessIntensityFn).toHaveBeenCalledWith(50);
  });
});

describe('bulk writes: eq/delay/names', () => {
  beforeEach(async () => {
    await bootMock('rp2350');
    const bulk = parseBulkParams(makeBulk());
    liveMirror().init(fromBulkParams(testHardware, bulk));
  });


  it('setOutputDelay sends a write and patches the slot delay after ack', async () => {
    vi.useFakeTimers();
    const setOutputDelayFn = vi.fn(async () => {});
    const device = initializedDevice({
      setOutputDelay: setOutputDelayFn,
      getAllParams: vi.fn(async () => parseBulkParams(makeBulk())),
    });
    dispatch({ t: 'synced', session: makeReadySession(device) });
    liveMirror().replaceCurrent(fromBulkParams(createHardwareProfile(PlatformType.RP2350), parseBulkParams(makeBulk())));
    const slot = liveMirror().current!.outputs[0].wireIndex;
    setOutputDelay(activeSession()!, slot, 5);
    await vi.runAllTimersAsync();
    const o = liveMirror().current!.outputs.find((o) => o.wireIndex === slot)!;
    expect(o.delayMs).toBe(5);
    expect(setOutputDelayFn).toHaveBeenCalledWith(slot, 5);
    vi.useRealTimers();
  });

  it('setChannelName sets name and mirrors to the denormalized output entry', async () => {
    vi.useFakeTimers();
    const setChannelNameFn = vi.fn(async () => {});
    const device = initializedDevice({
      setChannelName: setChannelNameFn,
      getAllParams: vi.fn(async () => parseBulkParams(makeBulk())),
    });
    dispatch({ t: 'synced', session: makeReadySession(device) });
    liveMirror().replaceCurrent(fromBulkParams(createHardwareProfile(PlatformType.RP2350), parseBulkParams(makeBulk())));
    const outId = liveMirror().current!.outputs[0].id; // a channel that DOES have an output entry
    setChannelName(activeSession()!, outId, 'Custom');
    await vi.runAllTimersAsync();
    expect(liveMirror().current!.channels.find((c) => c.id === outId)!.name).toBe('Custom');
    expect(liveMirror().current!.outputs.find((o) => o.id === outId)!.name).toBe('Custom');
    vi.useRealTimers();
  });
});

describe('crosspoint — granular per-cell write (whole-tuple merge)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    const bulk = parseBulkParams(makeBulk());
    dispatch({ t: 'synced', session: makeReadySession({} as never) });
    liveMirror().replaceCurrent(fromBulkParams(createHardwareProfile(PlatformType.RP2350), bulk));
  });
  afterEach(() => { vi.useRealTimers(); });

  it('setCrosspointEnabled sends a full setMatrixRoute tuple via the per-item lane', async () => {
    const calls: Array<{ enabled: boolean; invert: boolean; gainDb: number }> = [];
    const device = initializedDevice({
      setMatrixRoute: vi.fn(async (_i: number, _o: number, cp) => { calls.push(cp); }),
      getAllParams: vi.fn(async () => parseBulkParams(makeBulk())),
    });
    dispatch({ t: 'synced', session: makeReadySession(device) });
    liveMirror().replaceCurrent(fromBulkParams(createHardwareProfile(PlatformType.RP2350), parseBulkParams(makeBulk())));
    const route = liveMirror().current!.routes[0];
    const before = route.enabled;
    setCrosspointEnabled(activeSession()!, route.inputIndex, route.outputWireIndex, !before);
    expect(liveMirror().current!.routes[0].enabled).toBe(before);    // not optimistic — unchanged until ack
    await vi.runAllTimersAsync();
    expect(liveMirror().current!.routes[0].enabled).toBe(!before);   // patched after ack
    expect(calls).toHaveLength(1);
    expect(calls[0].enabled).toBe(!before);
  });

  it('sequential enable then gain edits on a cell each send the merged tuple', async () => {
    const calls: Array<{ enabled: boolean; invert: boolean; gainDb: number }> = [];
    const device = initializedDevice({
      setMatrixRoute: vi.fn(async (_i: number, _o: number, cp) => { calls.push(cp); }),
      getAllParams: vi.fn(async () => parseBulkParams(makeBulk())),
    });
    dispatch({ t: 'synced', session: makeReadySession(device) });
    liveMirror().replaceCurrent(fromBulkParams(createHardwareProfile(PlatformType.RP2350), parseBulkParams(makeBulk())));
    const route = liveMirror().current!.routes[0];
    const beforeEnabled = route.enabled;
    setCrosspointEnabled(activeSession()!, route.inputIndex, route.outputWireIndex, !beforeEnabled);
    await vi.runAllTimersAsync();
    setCrosspointGain(activeSession()!, route.inputIndex, route.outputWireIndex, -6);
    await vi.runAllTimersAsync();
    expect(calls).toHaveLength(2);                 // one send per edit
    // The gain send merges with the committed mirror: the enable edit (now
    // settled) is carried in the gain send's whole-tuple, not clobbered.
    expect(calls[1].enabled).toBe(!beforeEnabled);
    expect(calls[1].gainDb).toBe(-6);
  });

  it('setCrosspointInvert flips invert and the wire tuple reflects it', async () => {
    const calls: Array<{ enabled: boolean; invert: boolean; gainDb: number }> = [];
    const device = initializedDevice({
      setMatrixRoute: vi.fn(async (_i: number, _o: number, cp) => { calls.push(cp); }),
      getAllParams: vi.fn(async () => parseBulkParams(makeBulk())),
    });
    dispatch({ t: 'synced', session: makeReadySession(device) });
    liveMirror().replaceCurrent(fromBulkParams(createHardwareProfile(PlatformType.RP2350), parseBulkParams(makeBulk())));
    const route = liveMirror().current!.routes[0];
    const before = route.invert;
    setCrosspointInvert(activeSession()!, route.inputIndex, route.outputWireIndex, !before);
    await vi.runAllTimersAsync();
    expect(calls).toHaveLength(1);
    expect(calls[0].invert).toBe(!before);
  });
});

describe('output gain — optimistic scalar write', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    const bulk = parseBulkParams(makeBulk());
    dispatch({ t: 'synced', session: makeReadySession({} as never) });
    liveMirror().replaceCurrent(fromBulkParams(createHardwareProfile(PlatformType.RP2350), bulk));
  });
  afterEach(() => { vi.useRealTimers(); });

  it('setOutputGain sends the scalar and patches the mirror after ack', async () => {
    const calls: Array<[number, number]> = [];
    const device = initializedDevice({
      setOutputGain: vi.fn(async (slot: number, db: number) => { calls.push([slot, db]); }),
      getAllParams: vi.fn(async () => parseBulkParams(makeBulk())),
    });
    dispatch({ t: 'synced', session: makeReadySession(device) });
    liveMirror().replaceCurrent(fromBulkParams(createHardwareProfile(PlatformType.RP2350), parseBulkParams(makeBulk())));
    const slot = liveMirror().current!.outputs[0].wireIndex;
    const before = liveMirror().current!.outputs.find((o) => o.wireIndex === slot)!.gainDb;
    setOutputGain(activeSession()!, slot, -6);
    // Not optimistic: the mirror is unchanged until the ack lands.
    expect(liveMirror().current!.outputs.find((o) => o.wireIndex === slot)!.gainDb).toBe(before);
    await vi.runAllTimersAsync();
    expect(liveMirror().current!.outputs.find((o) => o.wireIndex === slot)!.gainDb).toBe(-6);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual([slot, -6]);
  });
});

describe('granular writes: eqFilter (per-band)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    const bulk = parseBulkParams(makeBulk());
    const device = initializedDevice({
      setFilter: vi.fn(async () => {}),
      getAllParams: vi.fn(async () => parseBulkParams(makeBulk())),
    });
    dispatch({ t: 'synced', session: makeReadySession(device) });
    liveMirror().replaceCurrent(fromBulkParams(createHardwareProfile(PlatformType.RP2350), bulk));
  });
  afterEach(() => { vi.useRealTimers(); });

  it('setEqFilter sends one band via setFilter and patches after ack', async () => {
    const calls: Array<{ channel: number; band: number; filter: FilterParams }> = [];
    const device = initializedDevice({
      setFilter: vi.fn(async (ch: number, band: number, f: FilterParams) => {
        calls.push({ channel: ch, band, filter: f });
      }),
      getAllParams: vi.fn(async () => parseBulkParams(makeBulk())),
    });
    dispatch({ t: 'synced', session: makeReadySession(device) });
    liveMirror().replaceCurrent(fromBulkParams(createHardwareProfile(PlatformType.RP2350), parseBulkParams(makeBulk())));
    const ch = liveMirror().current!.channels[0].id;
    const beforeGain = liveMirror().current!.channels[0].filters[0].gain;
    setEqFilter(activeSession()!, ch, 0, { type: FilterType.Peaking, bypass: false, frequency: 1000, q: 1.0, gain: 3 });
    expect(liveMirror().current!.channels[0].filters[0].gain).toBe(beforeGain); // not optimistic — unchanged until ack
    await vi.runAllTimersAsync();
    expect(liveMirror().current!.channels[0].filters[0].frequency).toBe(1000); // patched after ack
    expect(liveMirror().current!.channels[0].filters[0].gain).toBe(3);
    expect(calls).toHaveLength(1);
    expect(calls[0].band).toBe(0);
    expect(calls[0].filter.frequency).toBe(1000);
  });

  it('setEqFilter throws on out-of-range band', () => {
    const ch = liveMirror().current!.channels[0].id;
    const n = liveMirror().current!.channels[0].filters.length;
    expect(() => setEqFilter(activeSession()!, ch, n, { type: FilterType.Peaking, bypass: false, frequency: 1, q: 1, gain: 0 })).toThrow();
  });

  it('copyEqBands sends N independent setFilter calls (one per band)', async () => {
    const device = initializedDevice({
      setFilter: vi.fn(async () => {}),
      getAllParams: vi.fn(async () => parseBulkParams(makeBulk())),
    });
    dispatch({ t: 'synced', session: makeReadySession(device) });
    liveMirror().replaceCurrent(fromBulkParams(createHardwareProfile(PlatformType.RP2350), parseBulkParams(makeBulk())));
    const src = liveMirror().current!.channels[0].id;
    const tgt = liveMirror().current!.channels[1].id;
    const len = Math.min(liveMirror().current!.channels.find((c) => c.id === src)!.filters.length,
                         liveMirror().current!.channels.find((c) => c.id === tgt)!.filters.length);
    // Edit source first
    setEqFilter(activeSession()!, src, 0, { type: FilterType.Peaking, bypass: false, frequency: 2500, q: 2, gain: -4 });
    setEqFilter(activeSession()!, src, 1, { type: FilterType.Peaking, bypass: false, frequency: 5000, q: 1.5, gain: 2 });
    await vi.runAllTimersAsync();
    // Reset mock call count for copyEqBands test
    vi.mocked(device.setFilter).mockClear();
    // Now copy to target
    copyEqBands(activeSession()!, src, tgt);
    await vi.runAllTimersAsync(); // flush so sends resolve and mutates apply
    const t = liveMirror().current!.channels.find((c) => c.id === tgt)!;
    const s = liveMirror().current!.channels.find((c) => c.id === src)!;
    expect(t.filters[0].frequency).toBe(2500); // patched after ack
    expect(t.filters[1].frequency).toBe(5000);
    expect(s.filters[0].frequency).toBe(2500); // source unchanged
    expect(s.filters[1].frequency).toBe(5000);
    expect(device.setFilter).toHaveBeenCalledTimes(len); // N independent setFilter calls
    const calls = vi.mocked(device.setFilter).mock.calls;
    expect(calls[0][1]).toBe(0); // band
    expect(calls[0][2].frequency).toBe(2500);
    expect(calls[1][1]).toBe(1); // band
    expect(calls[1][2].frequency).toBe(5000);
  });
});

describe('dual-lane inflight coexistence: scrub-class + write-class share the counter', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  // Sends are parked forever here so the counter stays bumped at assertion
  // time; the file-scope afterEach (endConnection + cancelWrites) resets the
  // leaked bulk-flush + granular state.
  afterEach(() => { vi.useRealTimers(); });

  it('writes on different controls both register in inflight', async () => {
    const bulk = parseBulkParams(makeBulk());
    const device = initializedDevice({
      // Both sends park forever so neither token is released during the test.
      setMasterVolume: vi.fn(() => new Promise<void>(() => {})),
      setBypass: vi.fn(() => new Promise<void>(() => {})),
      getAllParams: vi.fn(async () => bulk),
    });
    dispatch({ t: 'synced', session: makeReadySession(device) });
    liveMirror().init(fromBulkParams(testHardware, bulk));

    expect(activeSession()!.mirror.inflight).toBe(0);
    // scrub-class: masterVolume uses scrub() → bumpInflight() at schedule time.
    setMasterVolume(activeSession()!, -6);
    expect(activeSession()!.mirror.inflight).toBe(1);
    // write-class: bypass uses write() → bumpInflight() as well.
    setBypass(activeSession()!, true);
    expect(activeSession()!.mirror.inflight).toBe(2);
    // Both writes in flight: the resync soft-skip guard covers both.
    expect(activeSession()!.mirror.inflight).toBeGreaterThan(0);
  });
});

describe('boolean device flags are explicit setters', () => {
  beforeEach(async () => {
    await bootMock('rp2350');
    const bulk = parseBulkParams(makeBulk());
    liveMirror().init(fromBulkParams(testHardware, bulk));
  });

  it('setOutputEnabled(0, false) disables the output', async () => {
    vi.useFakeTimers();
    const setOutputEnableFn = vi.fn(async () => {});
    const device = initializedDevice({
      setOutputEnable: setOutputEnableFn,
      getAllParams: vi.fn(async () => parseBulkParams(makeBulk())),
    });
    dispatch({ t: 'synced', session: makeReadySession(device) });
    liveMirror().replaceCurrent(fromBulkParams(createHardwareProfile(PlatformType.RP2350), parseBulkParams(makeBulk())));
    const slot = liveMirror().current!.outputs[0].wireIndex;
    setOutputEnabled(activeSession()!, slot, false);
    await vi.runAllTimersAsync();
    expect(liveMirror().current?.outputs.find((o) => o.wireIndex === slot)?.enabled).toBe(false);
    expect(setOutputEnableFn).toHaveBeenCalledWith(slot, false);
    vi.useRealTimers();
  });

  it('setOutputEnabled(0, true) enables the output', async () => {
    vi.useFakeTimers();
    const setOutputEnableFn = vi.fn(async () => {});
    const device = initializedDevice({
      setOutputEnable: setOutputEnableFn,
      getAllParams: vi.fn(async () => parseBulkParams(makeBulk())),
    });
    dispatch({ t: 'synced', session: makeReadySession(device) });
    liveMirror().replaceCurrent(fromBulkParams(createHardwareProfile(PlatformType.RP2350), parseBulkParams(makeBulk())));
    const slot = liveMirror().current!.outputs[0].wireIndex;
    // First disable it
    setOutputEnabled(activeSession()!, slot, false);
    await vi.runAllTimersAsync();
    // Then explicitly enable
    setOutputEnabled(activeSession()!, slot, true);
    await vi.runAllTimersAsync();
    expect(liveMirror().current?.outputs.find((o) => o.wireIndex === slot)?.enabled).toBe(true);
    expect(setOutputEnableFn).toHaveBeenLastCalledWith(slot, true);
    vi.useRealTimers();
  });

  it('setOutputMuted(0, true) mutes the output', async () => {
    vi.useFakeTimers();
    const setOutputMuteFn = vi.fn(async () => {});
    const device = initializedDevice({
      setOutputMute: setOutputMuteFn,
      getAllParams: vi.fn(async () => parseBulkParams(makeBulk())),
    });
    dispatch({ t: 'synced', session: makeReadySession(device) });
    liveMirror().replaceCurrent(fromBulkParams(createHardwareProfile(PlatformType.RP2350), parseBulkParams(makeBulk())));
    const slot = liveMirror().current!.outputs[0].wireIndex;
    setOutputMuted(activeSession()!, slot, true);
    await vi.runAllTimersAsync();
    expect(liveMirror().current?.outputs.find((o) => o.wireIndex === slot)?.muted).toBe(true);
    expect(setOutputMuteFn).toHaveBeenCalledWith(slot, true);
    vi.useRealTimers();
  });

  it('setOutputMuted(0, false) unmutes the output', async () => {
    vi.useFakeTimers();
    const setOutputMuteFn = vi.fn(async () => {});
    const device = initializedDevice({
      setOutputMute: setOutputMuteFn,
      getAllParams: vi.fn(async () => parseBulkParams(makeBulk())),
    });
    dispatch({ t: 'synced', session: makeReadySession(device) });
    liveMirror().replaceCurrent(fromBulkParams(createHardwareProfile(PlatformType.RP2350), parseBulkParams(makeBulk())));
    const slot = liveMirror().current!.outputs[0].wireIndex;
    // First mute it
    setOutputMuted(activeSession()!, slot, true);
    await vi.runAllTimersAsync();
    // Then explicitly unmute
    setOutputMuted(activeSession()!, slot, false);
    await vi.runAllTimersAsync();
    expect(liveMirror().current?.outputs.find((o) => o.wireIndex === slot)?.muted).toBe(false);
    expect(setOutputMuteFn).toHaveBeenLastCalledWith(slot, false);
    vi.useRealTimers();
  });

  it('setCrosspointEnabled sets enabled to a specific value (not just toggle)', async () => {
    vi.useFakeTimers();
    const calls: Array<{ enabled: boolean; invert: boolean; gainDb: number }> = [];
    const device = initializedDevice({
      setMatrixRoute: vi.fn(async (_i: number, _o: number, cp) => { calls.push(cp); }),
      getAllParams: vi.fn(async () => parseBulkParams(makeBulk())),
    });
    dispatch({ t: 'synced', session: makeReadySession(device) });
    liveMirror().replaceCurrent(fromBulkParams(createHardwareProfile(PlatformType.RP2350), parseBulkParams(makeBulk())));
    const route = liveMirror().current!.routes[0];
    const initial = route.enabled;
    setCrosspointEnabled(activeSession()!, route.inputIndex, route.outputWireIndex, !initial);
    await vi.runAllTimersAsync();
    expect(liveMirror().current!.routes[0].enabled).toBe(!initial);
    // Calling with the same value again must not flip it back (set, not toggle).
    setCrosspointEnabled(activeSession()!, route.inputIndex, route.outputWireIndex, !initial);
    await vi.runAllTimersAsync();
    expect(liveMirror().current!.routes[0].enabled).toBe(!initial);
    expect(calls.at(-1)!.enabled).toBe(!initial);
    vi.useRealTimers();
  });

  it('setCrosspointInvert sets invert to a specific value (not just toggle)', async () => {
    vi.useFakeTimers();
    const calls: Array<{ enabled: boolean; invert: boolean; gainDb: number }> = [];
    const device = initializedDevice({
      setMatrixRoute: vi.fn(async (_i: number, _o: number, cp) => { calls.push(cp); }),
      getAllParams: vi.fn(async () => parseBulkParams(makeBulk())),
    });
    dispatch({ t: 'synced', session: makeReadySession(device) });
    liveMirror().replaceCurrent(fromBulkParams(createHardwareProfile(PlatformType.RP2350), parseBulkParams(makeBulk())));
    const route = liveMirror().current!.routes[0];
    const initial = route.invert;
    setCrosspointInvert(activeSession()!, route.inputIndex, route.outputWireIndex, !initial);
    await vi.runAllTimersAsync();
    expect(liveMirror().current!.routes[0].invert).toBe(!initial);
    // Calling with the same value again must not flip it back (set, not toggle).
    setCrosspointInvert(activeSession()!, route.inputIndex, route.outputWireIndex, !initial);
    await vi.runAllTimersAsync();
    expect(liveMirror().current!.routes[0].invert).toBe(!initial);
    expect(calls.at(-1)!.invert).toBe(!initial);
    vi.useRealTimers();
  });
});

describe('output config verbs', () => {
  beforeEach(async () => {
    await bootMock('rp2350');
    clearNotices();
  });

  it('setOutputDataPin success patches draft.outputPins without discarding other edits', async () => {
    const before = liveMirror().current!.masterVolumeDb;
    setOutputDataPin(activeSession()!, 0, 16);
    await flushAllWrites();
    expect(liveMirror().current!.outputPins[0]).toBe(16);
    expect(liveMirror().current!.masterVolumeDb).toBe(before);
  });

  it('setOutputDataPin failure leaves outputPins unchanged and toasts the device message', async () => {
    // pin 7 is in use by pinOutputIndex 1 — mock returns PinInUse
    const pinsBefore = liveMirror().current!.outputPins.slice();
    setOutputDataPin(activeSession()!, 0, 7);
    await flushAllWrites();
    expect(liveMirror().current!.outputPins).toEqual(pinsBefore);
    expect(notices.list).toHaveLength(1);
    expect(notices.list[0].message).toContain('in use');
  });

  it('setOutputType updates draft.i2s.outputSlotTypes', async () => {
    setOutputType(activeSession()!, 0, 1);
    await flushAllWrites();
    expect(liveMirror().current!.i2s.outputSlotTypes[0]).toBe(1);
  });

  test('setI2sBckPin success patches draft.i2s.bckPin', async () => {
    setI2sBckPin(activeSession()!, 16);
    await flushAllWrites();
    expect(liveMirror().current!.i2s.bckPin).toBe(16);
  });

  test('setMckEnabled success patches draft.i2s.mckEnabled', async () => {
    setMckEnabled(activeSession()!, true);
    await flushAllWrites();
    expect(liveMirror().current!.i2s.mckEnabled).toBe(true);
  });

  it('requests a reconcile on a successful config write, honoring eagerReconcile', async () => {
    settings.eagerReconcile = true;
    activeSession()!.mirror.consumeReconcile(); // clear anything pending from boot
    setI2sBckPin(activeSession()!, 16);
    await flushAllWrites();
    expect(activeSession()!.mirror.peekReconcile()).toEqual({ wanted: true, eager: true });
    settings.eagerReconcile = false;
  });

  it('factoryResetDevice toasts completion on success', async () => {
    await factoryResetDevice();
    expect(notices.list.some((n) => n.kind === 'info' && n.message.includes('Factory reset complete'))).toBe(true);
  });
});

