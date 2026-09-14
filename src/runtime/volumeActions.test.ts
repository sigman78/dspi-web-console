import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as actions from './volumeActions';
import { attachTransportListeners } from './deviceService';
import { connection, notices, clearNotices, dispatch, mintConnId, makeReadySession, activeSession, resetAppState } from '@/state';
import { bootMock } from './boot';
import type { DspTransport, TransportEvent } from '@/transport/DspTransport';
import type { DspDevice } from '@/device/DspDevice';
import { parseBulkParams } from '@/protocol';
import { PlatformType, createHardwareProfile, MasterVolumeMode } from '@/domain';
import { fromBulkParams } from '@/protocol/snapshotCodec';
import { deriveCapabilities } from '@/protocol/capabilities';
import { makeBulk } from '@test/fixtures/bulkFixtures';
import { flushAllWrites as flushAllWritesFor } from './writes.svelte';
import { ConnectionScope } from './connectionScope';

const cancelWrites = () => { const s = activeSession(); if (s) s.writes.cancel(); };
const flushAllWrites = () => flushAllWritesFor(activeSession()!);

const testHardware = createHardwareProfile(PlatformType.RP2350);

// Builds a DspDevice stub with identity defaults. Any method can be overridden.
function initializedDevice(methods: Partial<DspDevice>): DspDevice {
  const base: Partial<DspDevice> = {
    info: {
      serial: 'TEST-RP2350',
      platformType: PlatformType.RP2350,
      hardware: testHardware,
      capabilities: deriveCapabilities({
        fw: { major: 1, minor: 1, patch: 4 }, wireVersion: 10, payloadLength: 2960, platformId: 1,
      }),
      build: null,
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

// Module-scoped state leaks across tests in this file and must be reset after
// every test, or it poisons a later test under a shuffled run order:
//   - the rAF polling loop started by bootMock → wireUpConnection → startPolling.
//     poll's tick() re-arms requestAnimationFrame unconditionally; with fake
//     timers faking rAF, a later vi.runAllTimersAsync() churns it forever and
//     aborts with "10000 timers, assuming an infinite loop". Disposing the
//     active session aborts its scope, which stops the loop.
//   - device/writes scrub-lane registry + inflight counter.
//     cancelWrites() (calls s.writes.cancel()) clears lanes and drops tokens.
afterEach(() => { activeSession()?.dispose(); cancelWrites(); resetAppState(); });

// Each beforeEach/test installs a ready session (dispatch synced) BEFORE touching
// the mirror, so this resolves the active session's MirrorState.
const liveMirror = () => activeSession()!.mirror;

describe('actions wiring', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    const bulk = parseBulkParams(makeBulk({ masterVolumeDb: 0 }));
    dispatch({ t: 'synced', id: mintConnId(), session: makeReadySession({} as never) });
    liveMirror().replaceCurrent(fromBulkParams(createHardwareProfile(PlatformType.RP2350), bulk));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('toggleMute flips userVolume.mute on the device and does not touch masterVolume', async () => {
    const setUserMuteFn = vi.fn(async () => {});
    const setMasterVolumeFn = vi.fn(async () => {});
    const device = initializedDevice({
      setUserMute: setUserMuteFn,
      setMasterVolume: setMasterVolumeFn,
      getAllParams: vi.fn(async () => parseBulkParams(makeBulk())),
    });
    dispatch({ t: 'synced', id: mintConnId(), session: makeReadySession(device) });
    const snap = fromBulkParams(createHardwareProfile(PlatformType.RP2350), parseBulkParams(makeBulk({ masterVolumeDb: -12 })));
    if (snap.userVolume) snap.userVolume.mute = false;
    liveMirror().replaceCurrent(snap);

    actions.toggleMute(activeSession()!);
    await vi.runAllTimersAsync();

    expect(setUserMuteFn).toHaveBeenCalledWith(true);
    expect(liveMirror().current?.userVolume?.mute).toBe(true);
    expect(setMasterVolumeFn).not.toHaveBeenCalled();
    expect(liveMirror().current?.masterVolumeDb).toBe(-12);

    // toggle back
    actions.toggleMute(activeSession()!);
    await vi.runAllTimersAsync();
    expect(setUserMuteFn).toHaveBeenCalledWith(false);
    expect(liveMirror().current?.userVolume?.mute).toBe(false);
  });

  it('disconnect cancels pending coalescer + resync and resets state', async () => {
    const { device, calls } = makeFakeDevice();
    const transport = new FakeTransport();
    // Mirror production wiring: the session shares the connection's scope (as
    // wireUpConnection does), and the transport-disconnect listener is
    // registered on that same scope (as attachTransportListeners is in
    // createBoundDevice). scope.abort() -- fired by the disconnect handler --
    // tears down both the listener and the session's write lanes in one shot,
    // which is what drops the pending coalescer write.
    // Drop the describe-level default session first: this test wants exactly
    // one record in the registry, so a disconnect has no dormant record to
    // promote (the outer beforeEach's stub session has no live device behind
    // it, and promoting it would start real loops against it).
    resetAppState();
    const id = mintConnId();
    const scope = new ConnectionScope();
    dispatch({ t: 'synced', id, session: makeReadySession(device, scope) });
    liveMirror().replaceCurrent(fromBulkParams(createHardwareProfile(PlatformType.RP2350), parseBulkParams(makeBulk({ masterVolumeDb: 0 }))));
    scope.onTeardown(attachTransportListeners(transport, id, scope));

    actions.setMasterVolume(activeSession()!, -9);    // sends immediately
    actions.setMasterVolume(activeSession()!, -6);    // parks behind the in-flight send
    transport.emit('disconnect');             // should drop the parked send

    await vi.advanceTimersByTimeAsync(100);
    await vi.runAllTimersAsync();

    expect(calls).toEqual([-9]);              // parked -6 dropped
    expect(connection.phase).toBe('noDevice');
    expect(activeSession()).toBeNull();       // session (and its telemetry) dropped
  });
});

describe('actions — master volume mode', () => {
  beforeEach(async () => {
    await bootMock('rp2350');
  });

  it('setMasterVolumeMode flips the directory cache value', async () => {
    activeSession()!.presets.directory = {
      occupiedSlotsSet: new Set(),
      startupMode: 0, defaultSlot: 0 as any, lastActiveSlot: null,
      outputConfigMode: 0 as any,
      masterVolumeMode: MasterVolumeMode.Independent,
    };
    actions.setMasterVolumeMode(activeSession()!, MasterVolumeMode.WithPreset);
    await vi.waitFor(() => expect(activeSession()!.presets.directory!.masterVolumeMode).toBe(MasterVolumeMode.WithPreset));
  });

  it('saveMasterVolumeBaseline warns with the device message on failure, and stays silent on success', async () => {
    clearNotices();
    const failDevice = initializedDevice({
      saveMasterVolume: async () => ({ ok: false as const, code: 3 as any, message: 'preset CRC failure' }),
    });
    dispatch({ t: 'synced', id: mintConnId(), session: makeReadySession(failDevice) });
    liveMirror().replaceCurrent(fromBulkParams(createHardwareProfile(PlatformType.RP2350), parseBulkParams(makeBulk())));
    actions.saveMasterVolumeBaseline(activeSession()!);
    await flushAllWrites();
    expect(notices.list.some((n) => n.kind === 'warn' && /master volume/i.test(n.message) && /preset CRC failure/.test(n.message))).toBe(true);

    clearNotices();
    const okDevice = initializedDevice({ saveMasterVolume: async () => ({ ok: true as const, value: undefined }) });
    dispatch({ t: 'synced', id: mintConnId(), session: makeReadySession(okDevice) });
    liveMirror().replaceCurrent(fromBulkParams(createHardwareProfile(PlatformType.RP2350), parseBulkParams(makeBulk())));
    actions.saveMasterVolumeBaseline(activeSession()!);
    await flushAllWrites();
    expect(notices.list).toHaveLength(0);
    expect(activeSession()!.presets.savedMasterVolumeDb).toBe(liveMirror().current!.masterVolumeDb);
  });
});

// Thin verbs: each just sends one value to one device method and patches one
// mirror field once the send settles (immediately for scrub-lane verbs,
// after ack for write-lane verbs). One table proves the method/argument/
// mirror-field/lane wiring for all of them instead of a bespoke describe per verb.
interface ThinVerbCase {
  name: string;
  method: string;
  mirrorPath: string;
  lane: 'write' | 'scrub';
  makeStub: (fn: () => Promise<void>) => Partial<DspDevice>;
  invoke: () => void;
  expectedArgs: () => unknown[];
  read: () => unknown;
  expected: unknown;
}

const thinVerbCases: ThinVerbCase[] = [
  { name: 'setBypass', method: 'setBypass', mirrorPath: 'bypass', lane: 'write', makeStub: (fn) => ({ setBypass: fn }), invoke: () => actions.setBypass(activeSession()!, true), expectedArgs: () => [true], read: () => liveMirror().current!.bypass, expected: true },
  { name: 'setUserMute', method: 'setUserMute', mirrorPath: 'userVolume.mute', lane: 'write', makeStub: (fn) => ({ setUserMute: fn }), invoke: () => actions.setUserMute(activeSession()!, true), expectedArgs: () => [true], read: () => liveMirror().current!.userVolume?.mute, expected: true },
];

describe('thin verbs: device call + mirror patch (parameterized)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it.each(thinVerbCases)('$name calls device.$method and patches $mirrorPath ($lane lane)', async (c) => {
    const fn = vi.fn(async () => {});
    const device = initializedDevice({
      ...c.makeStub(fn),
      getAllParams: vi.fn(async () => parseBulkParams(makeBulk())),
    });
    dispatch({ t: 'synced', id: mintConnId(), session: makeReadySession(device) });
    liveMirror().replaceCurrent(fromBulkParams(createHardwareProfile(PlatformType.RP2350), parseBulkParams(makeBulk())));

    const before = c.read();
    c.invoke();
    if (c.lane === 'scrub') {
      expect(c.read()).toEqual(c.expected);   // optimistic: patched immediately
    } else {
      expect(c.read()).toEqual(before);       // write lane: unchanged until ack
    }
    await vi.runAllTimersAsync();
    expect(c.read()).toEqual(c.expected);     // patched after settle
    expect(fn).toHaveBeenCalledWith(...c.expectedArgs());
  });
});
