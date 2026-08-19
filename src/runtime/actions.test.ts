import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as actions from './actions';
import { attachTransportListeners, factoryResetDevice } from './deviceService';
import { connection, notices, clearNotices, dispatch, mintConnId, makeReadySession, activeSession, resetAppState } from '@/state';
import { bootMock } from './boot';
import type { DspTransport, TransportEvent } from '@/transport/DspTransport';
import type { DspDevice } from '@/device/DspDevice';
import { parseBulkParams, PinConfigResult, Wire } from '@/protocol';
import { Result } from '@/utils';
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
  matrixColumns,
  AudioInputSource,
  type DacHwMute,
  type UartControlConfig,
  type ControlIfaceStatus,
} from '@/domain';
import { fromBulkParams } from '@/protocol/snapshotCodec';
import { deriveCapabilities } from '@/protocol/capabilities';

import { flushAllWrites as flushAllWritesFor } from './writes.svelte';
import { ConnectionScope } from './connectionScope';

// Test wrappers: the write lanes are now session-scoped, but these cleanup/flush
// call sites always target whatever session is active. Resolve it here so the
// existing call sites stay unchanged.
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

  it('copyEqBands copies all bands into the snapshot in N granular operations', async () => {
    // copyEqBands issues N independent write() calls (one per band); snapshot
    // is updated after each send acks (await-then-mutate).
    const validBulk = parseBulkParams(makeBulk());
    const device = initializedDevice({
      setFilter: vi.fn(async () => {}),
      getAllParams: vi.fn(async () => validBulk),
    });
    dispatch({ t: 'synced', id: mintConnId(), session: makeReadySession(device) });
    liveMirror().replaceCurrent(fromBulkParams(createHardwareProfile(PlatformType.RP2350), parseBulkParams(makeBulk())));

    const sourceId = liveMirror().current!.channels[0].id;
    const targetId = liveMirror().current!.channels[1].id;
    actions.copyEqBands(activeSession()!, sourceId, targetId);
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
    dispatch({ t: 'synced', id: mintConnId(), session: makeReadySession(device) });
    liveMirror().replaceCurrent(fromBulkParams(createHardwareProfile(PlatformType.RP2350), bulk));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('patches the snapshot after send acks', async () => {
    // setEqFilter awaits the wire send, then mutates draft (await-then-mutate).
    const beforeFreq = liveMirror().current!.channels[0].filters[1].frequency;
    actions.setEqFilter(activeSession()!, 0, 1, { type: FilterType.Peaking, bypass: false, frequency: 2000, q: 1, gain: 3 });
    expect(liveMirror().current?.channels[0].filters[1].frequency).toBe(beforeFreq); // not optimistic — unchanged until ack
    await vi.runAllTimersAsync();
    expect(liveMirror().current?.channels[0].filters[1].frequency).toBe(2000);
    expect(liveMirror().current?.channels[0].filters[1].type).toBe(FilterType.Peaking);
    expect(liveMirror().current?.channels[0].filters[1].gain).toBe(3);
  });

  it('rapid edits to the same band each apply independently (no coalescing)', async () => {
    // Each write() call is independent; the snapshot holds the last applied value.
    for (let f = 100; f <= 1000; f += 100) {
      actions.setEqFilter(activeSession()!, 0, 1, { type: FilterType.Peaking, bypass: false, frequency: f, q: 1, gain: 0 });
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
    dispatch({ t: 'synced', id: mintConnId(), session: makeReadySession(device) });
    liveMirror().replaceCurrent(fromBulkParams(createHardwareProfile(PlatformType.RP2350), parseBulkParams(makeBulk())));
    // Edit frequency, let it settle, then edit gain built from the updated band
    // (the same {...current, ...patch} merge BandRow performs on commit).
    actions.setEqFilter(activeSession()!, 0, 1, { ...liveMirror().current!.channels[0].filters[1], frequency: 2000 });
    await vi.runAllTimersAsync();
    actions.setEqFilter(activeSession()!, 0, 1, { ...liveMirror().current!.channels[0].filters[1], gain: 4 });
    await vi.runAllTimersAsync();

    expect(calls).toHaveLength(2);
    expect(calls[1].frequency).toBe(2000);   // gain edit carried the settled frequency
    expect(calls[1].gain).toBe(4);
    expect(liveMirror().current?.channels[0].filters[1].frequency).toBe(2000);
    expect(liveMirror().current?.channels[0].filters[1].gain).toBe(4);
  });

  it('edits to different bands are all reflected in the snapshot', async () => {
    actions.setEqFilter(activeSession()!, 0, 0, { type: FilterType.Peaking, bypass: false, frequency: 100, q: 1, gain: 0 });
    actions.setEqFilter(activeSession()!, 0, 1, { type: FilterType.Peaking, bypass: false, frequency: 200, q: 1, gain: 0 });
    actions.setEqFilter(activeSession()!, 0, 2, { type: FilterType.Peaking, bypass: false, frequency: 300, q: 1, gain: 0 });
    await vi.runAllTimersAsync();
    expect(liveMirror().current?.channels[0].filters[0].frequency).toBe(100);
    expect(liveMirror().current?.channels[0].filters[1].frequency).toBe(200);
    expect(liveMirror().current?.channels[0].filters[2].frequency).toBe(300);
  });

  it('throws on out-of-range band and leaves snapshot unchanged', async () => {
    const before = { ...liveMirror().current!.channels[0].filters[1] };
    const n = liveMirror().current!.channels[0].filters.length;
    expect(() => actions.setEqFilter(activeSession()!, 0, n, { type: FilterType.Peaking, bypass: false, frequency: 9999, q: 1, gain: 12 })).toThrow();
    await vi.runAllTimersAsync();
    // Snapshot must not have changed for the valid band.
    expect(liveMirror().current?.channels[0].filters[1]).toEqual(before);
  });

  // Linkwitz Transform's gain slot carries fp in Hz, not dB -- clamping it
  // with the plain +/-24 dB gain range would mangle a real fp value (e.g.
  // 90 Hz would get clamped down to 24). It needs its own freq/Q ranges.
  it('clamps an LT band with the f0/fp/Q0/Qp ranges instead of the plain freq/gain/Q ranges', async () => {
    actions.setEqFilter(activeSession()!, 0, 1, {
      type: FilterType.LinkwitzTransform, bypass: false, frequency: 5, q: 30, gain: 90000, qp: 0.05,
    });
    await vi.runAllTimersAsync();
    const band = liveMirror().current!.channels[0].filters[1];
    expect(band.frequency).toBe(10);   // LT_FREQ_MIN_HZ, not the plain FREQ_MIN_HZ (20)
    expect(band.q).toBe(20);           // LT_Q_MAX, not the plain Q_MAX (24)
    expect(band.gain).toBe(20000);     // fp clamped as a frequency (LT_FREQ_MAX_HZ), not as dB
    expect(band.qp).toBe(0.1);         // LT_Q_MIN
  });

  it('defaults a missing qp to QP_DEFAULT before clamping', async () => {
    actions.setEqFilter(activeSession()!, 0, 1, {
      type: FilterType.LinkwitzTransform, bypass: false, frequency: 60, q: 0.7, gain: 45,
    });
    await vi.runAllTimersAsync();
    expect(liveMirror().current?.channels[0].filters[1].qp).toBe(0.707);
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

const out0 = () => liveMirror().current!.outputs[0];

const thinVerbCases: ThinVerbCase[] = [
  { name: 'setMasterPreamp', method: 'setMasterPreamp', mirrorPath: 'masterPreampDb', lane: 'scrub', makeStub: (fn) => ({ setMasterPreamp: fn }), invoke: () => actions.setMasterPreamp(activeSession()!, -3), expectedArgs: () => [-3], read: () => liveMirror().current!.masterPreampDb, expected: -3 },
  { name: 'setCrossfeedPreset', method: 'setCrossfeedPreset', mirrorPath: 'crossfeed.preset', lane: 'write', makeStub: (fn) => ({ setCrossfeedPreset: fn }), invoke: () => actions.setCrossfeedPreset(activeSession()!, CrossfeedPreset.Preset2), expectedArgs: () => [CrossfeedPreset.Preset2], read: () => liveMirror().current!.crossfeed.preset, expected: CrossfeedPreset.Preset2 },
  { name: 'setLevellerSpeed', method: 'setLevellerSpeed', mirrorPath: 'leveller.speed', lane: 'write', makeStub: (fn) => ({ setLevellerSpeed: fn }), invoke: () => actions.setLevellerSpeed(activeSession()!, LevellerSpeed.Fast), expectedArgs: () => [LevellerSpeed.Fast], read: () => liveMirror().current!.leveller?.speed, expected: LevellerSpeed.Fast },
  { name: 'setLevellerAmount', method: 'setLevellerAmount', mirrorPath: 'leveller.amount', lane: 'scrub', makeStub: (fn) => ({ setLevellerAmount: fn }), invoke: () => actions.setLevellerAmount(activeSession()!, 33), expectedArgs: () => [33], read: () => liveMirror().current!.leveller?.amount, expected: 33 },
  { name: 'setLevellerMasks', method: 'setLevellerMasks', mirrorPath: 'leveller.detectorMask', lane: 'write', makeStub: (fn) => ({ setLevellerMasks: fn }), invoke: () => actions.setLevellerMasks(activeSession()!, 0x03, 0x05), expectedArgs: () => [0x03, 0x05], read: () => liveMirror().current!.leveller?.detectorMask, expected: 0x03 },
  { name: 'setLoudnessOutputMask', method: 'setLoudnessOutputMask', mirrorPath: 'loudness.outputMask', lane: 'write', makeStub: (fn) => ({ setLoudnessOutputMask: fn }), invoke: () => actions.setLoudnessOutputMask(activeSession()!, 0x00F0), expectedArgs: () => [0x00F0], read: () => liveMirror().current!.loudness.outputMask, expected: 0x00F0 },
  { name: 'setCrossfeedOutputPairs', method: 'setCrossfeedOutputPairs', mirrorPath: 'crossfeed.outputPairMask', lane: 'write', makeStub: (fn) => ({ setCrossfeedOutputPairs: fn }), invoke: () => actions.setCrossfeedOutputPairs(activeSession()!, 0x0D), expectedArgs: () => [0x0D], read: () => liveMirror().current!.crossfeed.outputPairMask, expected: 0x0D },
  { name: 'setLoudnessEnabled', method: 'setLoudnessEnabled', mirrorPath: 'loudness.enabled', lane: 'write', makeStub: (fn) => ({ setLoudnessEnabled: fn }), invoke: () => actions.setLoudnessEnabled(activeSession()!, true), expectedArgs: () => [true], read: () => liveMirror().current!.loudness.enabled, expected: true },
  { name: 'setLoudnessRefSpl', method: 'setLoudnessRefSpl', mirrorPath: 'loudness.refSpl', lane: 'scrub', makeStub: (fn) => ({ setLoudnessRefSpl: fn }), invoke: () => actions.setLoudnessRefSpl(activeSession()!, 90), expectedArgs: () => [90], read: () => liveMirror().current!.loudness.refSpl, expected: 90 },
  { name: 'setLoudnessIntensityPct', method: 'setLoudnessIntensity', mirrorPath: 'loudness.intensityPct', lane: 'scrub', makeStub: (fn) => ({ setLoudnessIntensity: fn }), invoke: () => actions.setLoudnessIntensityPct(activeSession()!, 50), expectedArgs: () => [50], read: () => liveMirror().current!.loudness.intensityPct, expected: 50 },
  { name: 'setBypass', method: 'setBypass', mirrorPath: 'bypass', lane: 'write', makeStub: (fn) => ({ setBypass: fn }), invoke: () => actions.setBypass(activeSession()!, true), expectedArgs: () => [true], read: () => liveMirror().current!.bypass, expected: true },
  { name: 'setUserMute', method: 'setUserMute', mirrorPath: 'userVolume.mute', lane: 'write', makeStub: (fn) => ({ setUserMute: fn }), invoke: () => actions.setUserMute(activeSession()!, true), expectedArgs: () => [true], read: () => liveMirror().current!.userVolume?.mute, expected: true },
  { name: 'setLgSoundSyncEnabled', method: 'setLgSoundSyncEnabled', mirrorPath: 'lgSoundSync.enabled', lane: 'write', makeStub: (fn) => ({ setLgSoundSyncEnabled: fn }), invoke: () => actions.setLgSoundSyncEnabled(activeSession()!, true), expectedArgs: () => [true], read: () => liveMirror().current!.lgSoundSync?.enabled, expected: true },
  { name: 'setOutputDelay', method: 'setOutputDelay', mirrorPath: 'outputs[0].delayMs', lane: 'write', makeStub: (fn) => ({ setOutputDelay: fn }), invoke: () => actions.setOutputDelay(activeSession()!, out0().wireIndex, 5), expectedArgs: () => [out0().wireIndex, 5], read: () => out0().delayMs, expected: 5 },
  { name: 'setOutputGain', method: 'setOutputGain', mirrorPath: 'outputs[0].gainDb', lane: 'write', makeStub: (fn) => ({ setOutputGain: fn }), invoke: () => actions.setOutputGain(activeSession()!, out0().wireIndex, -6), expectedArgs: () => [out0().wireIndex, -6], read: () => out0().gainDb, expected: -6 },
  { name: 'setBandBypass', method: 'setBandBypass', mirrorPath: 'channels[0].filters[0].bypass', lane: 'write', makeStub: (fn) => ({ setBandBypass: fn }), invoke: () => actions.setBandBypass(activeSession()!, liveMirror().current!.channels[0].id, 0, true), expectedArgs: () => [liveMirror().current!.channels[0].id, 0, true], read: () => liveMirror().current!.channels[0].filters[0].bypass, expected: true },
  // Slot-addressing case: channel 1, not the trivial default channel 0.
  { name: 'setInputPreamp', method: 'setInputPreamp', mirrorPath: 'inputPreampDb[1]', lane: 'scrub', makeStub: (fn) => ({ setInputPreamp: fn }), invoke: () => actions.setInputPreamp(activeSession()!, 1, -4), expectedArgs: () => [1, -4], read: () => liveMirror().current!.inputPreampDb[1], expected: -4 },
  { name: 'setOutputEnabled', method: 'setOutputEnable', mirrorPath: 'outputs[0].enabled', lane: 'write', makeStub: (fn) => ({ setOutputEnable: fn }), invoke: () => actions.setOutputEnabled(activeSession()!, out0().wireIndex, false), expectedArgs: () => [out0().wireIndex, false], read: () => out0().enabled, expected: false },
  { name: 'setPsybassEnabled', method: 'setPsybassEnabled', mirrorPath: 'psybass.enabled', lane: 'write', makeStub: (fn) => ({ setPsybassEnabled: fn }), invoke: () => actions.setPsybassEnabled(activeSession()!, true), expectedArgs: () => [true], read: () => liveMirror().current!.psybass.enabled, expected: true },
  { name: 'setPsybassCutoff', method: 'setPsybassCutoff', mirrorPath: 'psybass.cutoffHz', lane: 'scrub', makeStub: (fn) => ({ setPsybassCutoff: fn }), invoke: () => actions.setPsybassCutoff(activeSession()!, 120), expectedArgs: () => [120], read: () => liveMirror().current!.psybass.cutoffHz, expected: 120 },
  { name: 'setPsybassHarmonics', method: 'setPsybassHarmonics', mirrorPath: 'psybass.harmonicsDb', lane: 'scrub', makeStub: (fn) => ({ setPsybassHarmonics: fn }), invoke: () => actions.setPsybassHarmonics(activeSession()!, 4.5), expectedArgs: () => [4.5], read: () => liveMirror().current!.psybass.harmonicsDb, expected: 4.5 },
  { name: 'setPsybassDrive', method: 'setPsybassDrive', mirrorPath: 'psybass.driveDb', lane: 'scrub', makeStub: (fn) => ({ setPsybassDrive: fn }), invoke: () => actions.setPsybassDrive(activeSession()!, 9), expectedArgs: () => [9], read: () => liveMirror().current!.psybass.driveDb, expected: 9 },
  { name: 'setPsybassCharacter', method: 'setPsybassCharacter', mirrorPath: 'psybass.characterPct', lane: 'scrub', makeStub: (fn) => ({ setPsybassCharacter: fn }), invoke: () => actions.setPsybassCharacter(activeSession()!, 75), expectedArgs: () => [75], read: () => liveMirror().current!.psybass.characterPct, expected: 75 },
  { name: 'setPsybassOriginal', method: 'setPsybassOriginal', mirrorPath: 'psybass.originalDb', lane: 'scrub', makeStub: (fn) => ({ setPsybassOriginal: fn }), invoke: () => actions.setPsybassOriginal(activeSession()!, -12), expectedArgs: () => [-12], read: () => liveMirror().current!.psybass.originalDb, expected: -12 },
  { name: 'setPsybassOutputMask', method: 'setPsybassMask', mirrorPath: 'psybass.outputMask', lane: 'write', makeStub: (fn) => ({ setPsybassMask: fn }), invoke: () => actions.setPsybassOutputMask(activeSession()!, 0x00F0), expectedArgs: () => [0x00F0], read: () => liveMirror().current!.psybass.outputMask, expected: 0x00F0 },
  { name: 'setUpmixEnabled', method: 'setUpmixEnabled', mirrorPath: 'upmix.enabled', lane: 'write', makeStub: (fn) => ({ setUpmixEnabled: fn }), invoke: () => actions.setUpmixEnabled(activeSession()!, true), expectedArgs: () => [true], read: () => liveMirror().current!.upmix.enabled, expected: true },
  { name: 'setUpmixCenterMode', method: 'setUpmixCenterMode', mirrorPath: 'upmix.centerMode', lane: 'write', makeStub: (fn) => ({ setUpmixCenterMode: fn }), invoke: () => actions.setUpmixCenterMode(activeSession()!, 1), expectedArgs: () => [1], read: () => liveMirror().current!.upmix.centerMode, expected: 1 },
  { name: 'setUpmixSurroundMode', method: 'setUpmixSurroundMode', mirrorPath: 'upmix.surroundMode', lane: 'write', makeStub: (fn) => ({ setUpmixSurroundMode: fn }), invoke: () => actions.setUpmixSurroundMode(activeSession()!, 2), expectedArgs: () => [2], read: () => liveMirror().current!.upmix.surroundMode, expected: 2 },
  { name: 'setUpmixStrength', method: 'setUpmixStrength', mirrorPath: 'upmix.strengthPct', lane: 'scrub', makeStub: (fn) => ({ setUpmixStrength: fn }), invoke: () => actions.setUpmixStrength(activeSession()!, 75), expectedArgs: () => [75], read: () => liveMirror().current!.upmix.strengthPct, expected: 75 },
  { name: 'setUpmixCenterWidth', method: 'setUpmixCenterWidth', mirrorPath: 'upmix.centerWidthPct', lane: 'scrub', makeStub: (fn) => ({ setUpmixCenterWidth: fn }), invoke: () => actions.setUpmixCenterWidth(activeSession()!, 40), expectedArgs: () => [40], read: () => liveMirror().current!.upmix.centerWidthPct, expected: 40 },
  { name: 'setUpmixCorrThreshold', method: 'setUpmixCorrThreshold', mirrorPath: 'upmix.corrThresholdPct', lane: 'scrub', makeStub: (fn) => ({ setUpmixCorrThreshold: fn }), invoke: () => actions.setUpmixCorrThreshold(activeSession()!, 50), expectedArgs: () => [50], read: () => liveMirror().current!.upmix.corrThresholdPct, expected: 50 },
  { name: 'setUpmixAttack', method: 'setUpmixAttack', mirrorPath: 'upmix.attackMs', lane: 'scrub', makeStub: (fn) => ({ setUpmixAttack: fn }), invoke: () => actions.setUpmixAttack(activeSession()!, 20), expectedArgs: () => [20], read: () => liveMirror().current!.upmix.attackMs, expected: 20 },
  { name: 'setUpmixRelease', method: 'setUpmixRelease', mirrorPath: 'upmix.releaseMs', lane: 'scrub', makeStub: (fn) => ({ setUpmixRelease: fn }), invoke: () => actions.setUpmixRelease(activeSession()!, 200), expectedArgs: () => [200], read: () => liveMirror().current!.upmix.releaseMs, expected: 200 },
  { name: 'setUpmixDetectorHpf', method: 'setUpmixDetectorHpf', mirrorPath: 'upmix.detectorHpfHz', lane: 'scrub', makeStub: (fn) => ({ setUpmixDetectorHpf: fn }), invoke: () => actions.setUpmixDetectorHpf(activeSession()!, 150), expectedArgs: () => [150], read: () => liveMirror().current!.upmix.detectorHpfHz, expected: 150 },
  { name: 'setUpmixSurroundDelay', method: 'setUpmixSurroundDelay', mirrorPath: 'upmix.surroundDelayMs', lane: 'scrub', makeStub: (fn) => ({ setUpmixSurroundDelay: fn }), invoke: () => actions.setUpmixSurroundDelay(activeSession()!, 8), expectedArgs: () => [8], read: () => liveMirror().current!.upmix.surroundDelayMs, expected: 8 },
  { name: 'setUpmixSurroundHpf', method: 'setUpmixSurroundHpf', mirrorPath: 'upmix.surroundHpfHz', lane: 'scrub', makeStub: (fn) => ({ setUpmixSurroundHpf: fn }), invoke: () => actions.setUpmixSurroundHpf(activeSession()!, 400), expectedArgs: () => [400], read: () => liveMirror().current!.upmix.surroundHpfHz, expected: 400 },
  { name: 'setUpmixSurroundLpf', method: 'setUpmixSurroundLpf', mirrorPath: 'upmix.surroundLpfHz', lane: 'scrub', makeStub: (fn) => ({ setUpmixSurroundLpf: fn }), invoke: () => actions.setUpmixSurroundLpf(activeSession()!, 6000), expectedArgs: () => [6000], read: () => liveMirror().current!.upmix.surroundLpfHz, expected: 6000 },
  { name: 'setUpmixDecorr', method: 'setUpmixDecorr', mirrorPath: 'upmix.decorrPct', lane: 'scrub', makeStub: (fn) => ({ setUpmixDecorr: fn }), invoke: () => actions.setUpmixDecorr(activeSession()!, 80), expectedArgs: () => [80], read: () => liveMirror().current!.upmix.decorrPct, expected: 80 },
  { name: 'setUpmixPresence', method: 'setUpmixPresence', mirrorPath: 'upmix.presenceDb', lane: 'scrub', makeStub: (fn) => ({ setUpmixPresence: fn }), invoke: () => actions.setUpmixPresence(activeSession()!, 3), expectedArgs: () => [3], read: () => liveMirror().current!.upmix.presenceDb, expected: 3 },
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

describe('leveller channel masks (toggle logic)', () => {
  let masksFn: ReturnType<typeof vi.fn<() => Promise<void>>>;
  beforeEach(() => {
    vi.useFakeTimers();
    masksFn = vi.fn(async () => {});
    const device = initializedDevice({
      setLevellerMasks: masksFn,
      getAllParams: vi.fn(async () => parseBulkParams(makeBulk())),
    });
    dispatch({ t: 'synced', id: mintConnId(), session: makeReadySession(device) });
    liveMirror().replaceCurrent(fromBulkParams(createHardwareProfile(PlatformType.RP2350), parseBulkParams(makeBulk())));
  });
  afterEach(() => { vi.useRealTimers(); });

  it('starts all-on (0xFF / 0xFF)', () => {
    expect(liveMirror().current!.leveller?.detectorMask).toBe(0xFF);
    expect(liveMirror().current!.leveller?.applyMask).toBe(0xFF);
  });

  it('detector toggle clears one bit and leaves the apply mask untouched', async () => {
    actions.toggleLevellerDetectorChannel(activeSession()!, 0);
    await vi.runAllTimersAsync();
    expect(masksFn).toHaveBeenCalledWith(0xFE, 0xFF);
    expect(liveMirror().current!.leveller?.detectorMask).toBe(0xFE);
    expect(liveMirror().current!.leveller?.applyMask).toBe(0xFF);
  });

  it('apply toggle clears one bit and leaves the detector mask untouched', async () => {
    actions.toggleLevellerApplyChannel(activeSession()!, 2);
    await vi.runAllTimersAsync();
    expect(masksFn).toHaveBeenCalledWith(0xFF, 0xFB);
    expect(liveMirror().current!.leveller?.applyMask).toBe(0xFB);
    expect(liveMirror().current!.leveller?.detectorMask).toBe(0xFF);
  });

  it('toggling the same channel twice restores it', async () => {
    actions.toggleLevellerDetectorChannel(activeSession()!, 3);
    await vi.runAllTimersAsync();
    expect(liveMirror().current!.leveller?.detectorMask).toBe(0xF7);
    actions.toggleLevellerDetectorChannel(activeSession()!, 3);
    await vi.runAllTimersAsync();
    expect(liveMirror().current!.leveller?.detectorMask).toBe(0xFF);
  });
});

describe('loudness output mask (toggle logic)', () => {
  let maskFn: ReturnType<typeof vi.fn<() => Promise<void>>>;
  beforeEach(() => {
    vi.useFakeTimers();
    maskFn = vi.fn(async () => {});
    const device = initializedDevice({
      setLoudnessOutputMask: maskFn,
      getAllParams: vi.fn(async () => parseBulkParams(makeBulk())),
    });
    dispatch({ t: 'synced', id: mintConnId(), session: makeReadySession(device) });
    liveMirror().replaceCurrent(fromBulkParams(createHardwareProfile(PlatformType.RP2350), parseBulkParams(makeBulk())));
  });
  afterEach(() => { vi.useRealTimers(); });

  it('starts all-on (0xFFFF)', () => {
    expect(liveMirror().current!.loudness.outputMask).toBe(0xFFFF);
  });

  it('toggle clears one bit and re-sends the whole mask', async () => {
    actions.toggleLoudnessOutputChannel(activeSession()!, 0);
    await vi.runAllTimersAsync();
    expect(maskFn).toHaveBeenCalledWith(0xFFFE);
    expect(liveMirror().current!.loudness.outputMask).toBe(0xFFFE);
  });

  it('toggling the same channel twice restores it', async () => {
    actions.toggleLoudnessOutputChannel(activeSession()!, 5);
    await vi.runAllTimersAsync();
    expect(liveMirror().current!.loudness.outputMask).toBe(0xFFFF ^ (1 << 5));
    actions.toggleLoudnessOutputChannel(activeSession()!, 5);
    await vi.runAllTimersAsync();
    expect(liveMirror().current!.loudness.outputMask).toBe(0xFFFF);
  });
});

describe('psybass output mask (toggle logic)', () => {
  let maskFn: ReturnType<typeof vi.fn<() => Promise<void>>>;
  beforeEach(() => {
    vi.useFakeTimers();
    maskFn = vi.fn(async () => {});
    const device = initializedDevice({
      setPsybassMask: maskFn,
      getAllParams: vi.fn(async () => parseBulkParams(makeBulk())),
    });
    dispatch({ t: 'synced', id: mintConnId(), session: makeReadySession(device) });
    liveMirror().replaceCurrent(fromBulkParams(createHardwareProfile(PlatformType.RP2350), parseBulkParams(makeBulk())));
  });
  afterEach(() => { vi.useRealTimers(); });

  it('starts all-on (0xFFFF)', () => {
    expect(liveMirror().current!.psybass.outputMask).toBe(0xFFFF);
  });

  it('toggle clears one bit and re-sends the whole mask', async () => {
    actions.togglePsybassOutputChannel(activeSession()!, 0);
    await vi.runAllTimersAsync();
    expect(maskFn).toHaveBeenCalledWith(0xFFFE);
    expect(liveMirror().current!.psybass.outputMask).toBe(0xFFFE);
  });

  it('toggling the same channel twice restores it', async () => {
    actions.togglePsybassOutputChannel(activeSession()!, 5);
    await vi.runAllTimersAsync();
    expect(liveMirror().current!.psybass.outputMask).toBe(0xFFFF ^ (1 << 5));
    actions.togglePsybassOutputChannel(activeSession()!, 5);
    await vi.runAllTimersAsync();
    expect(liveMirror().current!.psybass.outputMask).toBe(0xFFFF);
  });
});

describe('crossfeed output-pair mask (toggle logic)', () => {
  let maskFn: ReturnType<typeof vi.fn<() => Promise<void>>>;
  beforeEach(() => {
    vi.useFakeTimers();
    maskFn = vi.fn(async () => {});
    const device = initializedDevice({
      setCrossfeedOutputPairs: maskFn,
      getAllParams: vi.fn(async () => parseBulkParams(makeBulk())),
    });
    dispatch({ t: 'synced', id: mintConnId(), session: makeReadySession(device) });
    liveMirror().replaceCurrent(fromBulkParams(createHardwareProfile(PlatformType.RP2350), parseBulkParams(makeBulk())));
  });
  afterEach(() => { vi.useRealTimers(); });

  it('starts at pair 1 only (0x01)', () => {
    expect(liveMirror().current!.crossfeed.outputPairMask).toBe(0x01);
  });

  it('toggle sets an additional pair and re-sends the whole mask', async () => {
    actions.toggleCrossfeedOutputPair(activeSession()!, 1);
    await vi.runAllTimersAsync();
    expect(maskFn).toHaveBeenCalledWith(0x03);
    expect(liveMirror().current!.crossfeed.outputPairMask).toBe(0x03);
  });

  it('toggling the same pair twice restores it', async () => {
    actions.toggleCrossfeedOutputPair(activeSession()!, 2);
    await vi.runAllTimersAsync();
    expect(liveMirror().current!.crossfeed.outputPairMask).toBe(0x01 | (1 << 2));
    actions.toggleCrossfeedOutputPair(activeSession()!, 2);
    await vi.runAllTimersAsync();
    expect(liveMirror().current!.crossfeed.outputPairMask).toBe(0x01);
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
    dispatch({ t: 'synced', id: mintConnId(), session: makeReadySession(device) });
    liveMirror().replaceCurrent(fromBulkParams(createHardwareProfile(PlatformType.RP2350), bulk));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('patches the snapshot channels[i].name after send acks', async () => {
    // setChannelName awaits the wire send, then mutates draft (await-then-mutate).
    actions.setChannelName(activeSession()!, 0 satisfies ChannelId, 'Studio Left');
    await vi.runAllTimersAsync();
    expect(liveMirror().current!.channels[0].name).toBe('Studio Left');
  });

  it('treats empty input as a clear: snapshot falls back to defaultName', async () => {
    const defaultName = liveMirror().current!.channels[0].defaultName;
    actions.setChannelName(activeSession()!, 0 satisfies ChannelId, '');
    await vi.runAllTimersAsync();
    expect(liveMirror().current!.channels[0].name).toBe(defaultName);
  });

  it('trims whitespace-only input the same as empty', async () => {
    const defaultName = liveMirror().current!.channels[0].defaultName;
    actions.setChannelName(activeSession()!, 0 satisfies ChannelId, '   ');
    await vi.runAllTimersAsync();
    expect(liveMirror().current!.channels[0].name).toBe(defaultName);
  });

  it('trims whitespace and stores the resolved value in the snapshot', async () => {
    actions.setChannelName(activeSession()!, 0 satisfies ChannelId, '  padded  ');
    await vi.runAllTimersAsync();
    expect(liveMirror().current!.channels[0].name).toBe('padded'); // resolved (trimmed)
  });

  it('renamed output channel shows the new name through the matrix join', async () => {
    // ChannelId.Out1L = 2; corresponding outputs[] entry has wireIndex 0.
    // matrixColumns only surfaces enabled outputs, and the fixture default
    // is disabled, so enable the slot to join it.
    liveMirror().current!.outputs.find((o) => o.wireIndex === 0)!.enabled = true;
    actions.setChannelName(activeSession()!, 2 satisfies ChannelId, 'Front Left');
    await vi.runAllTimersAsync();

    const channel = liveMirror().current!.channels.find((c) => c.id === 2);
    const column = matrixColumns(liveMirror().current).find((c) => c.wireIdx === 0);
    expect(channel?.name).toBe('Front Left');
    expect(column?.name).toBe('Front Left');
  });

  it('renames RP2040 PDM and joins it at compact output slot 4', async () => {
    const rp2040Device = initializedDevice({
      setChannelName: vi.fn(async () => {}),
      getAllParams: vi.fn(async () => parseBulkParams(makeBulk())),
    });
    dispatch({ t: 'synced', id: mintConnId(), session: makeReadySession(rp2040Device) });
    liveMirror().replaceCurrent(makeSnapshot(PlatformType.RP2040));
    liveMirror().current!.outputs.find((o) => o.wireIndex === 4)!.enabled = true;

    actions.setChannelName(activeSession()!, 10 satisfies ChannelId, 'Sub');
    await vi.runAllTimersAsync();

    const channel = liveMirror().current!.channels.find((c) => c.id === 10);
    const column = matrixColumns(liveMirror().current).find((c) => c.wireIdx === 4);
    expect(channel?.name).toBe('Sub');
    expect(column?.name).toBe('Sub');
    expect(liveMirror().current!.outputs.some((o) => o.wireIndex === 8)).toBe(false);
  });

  it('does not change output column names when renaming an input channel', async () => {
    const namesBefore = matrixColumns(liveMirror().current).map((c) => c.name);

    // ChannelId.In1L = 0 — no entry in outputs[].
    actions.setChannelName(activeSession()!, 0 satisfies ChannelId, 'Mic 1');
    await vi.runAllTimersAsync();

    const namesAfter = matrixColumns(liveMirror().current).map((c) => c.name);
    expect(namesAfter).toEqual(namesBefore);
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

  it('saveOutputConfigBaseline warns on failure and stays silent on success', async () => {
    clearNotices();
    const failDevice = initializedDevice({
      saveOutputConfig: async () => ({ ok: false as const, code: 4 as any, message: 'preset flash write error' }),
    });
    dispatch({ t: 'synced', id: mintConnId(), session: makeReadySession(failDevice) });
    actions.saveOutputConfigBaseline(activeSession()!);
    await flushAllWrites();
    expect(notices.list.some((n) => n.kind === 'warn' && /output config/i.test(n.message))).toBe(true);

    clearNotices();
    const okDevice = initializedDevice({
      saveOutputConfig: async () => ({ ok: true as const, value: undefined }),
    });
    dispatch({ t: 'synced', id: mintConnId(), session: makeReadySession(okDevice) });
    actions.saveOutputConfigBaseline(activeSession()!);
    await flushAllWrites();
    expect(notices.list).toHaveLength(0);
  });
});

describe('bulk writes: toggles', () => {
  beforeEach(async () => {
    await bootMock('rp2350');
    const bulk = parseBulkParams(makeBulk());
    liveMirror().init(fromBulkParams(testHardware, bulk));
  });

  it('setOutputMuted sends a write and flips the slot after ack', async () => {
    vi.useFakeTimers();
    const setOutputMuteFn = vi.fn(async () => {});
    const device = initializedDevice({
      setOutputMute: setOutputMuteFn,
      getAllParams: vi.fn(async () => parseBulkParams(makeBulk())),
    });
    dispatch({ t: 'synced', id: mintConnId(), session: makeReadySession(device) });
    liveMirror().replaceCurrent(fromBulkParams(createHardwareProfile(PlatformType.RP2350), parseBulkParams(makeBulk())));
    const slot = liveMirror().current!.outputs[0].wireIndex;
    const before = liveMirror().current!.outputs[0].muted;
    actions.setOutputMuted(activeSession()!, slot, !before);
    await vi.runAllTimersAsync();
    expect(liveMirror().current?.outputs.find((o) => o.wireIndex === slot)?.muted).toBe(!before);
    expect(setOutputMuteFn).toHaveBeenCalledWith(slot, !before);
    vi.useRealTimers();
  });

  it('setOutputPairEnabled writes both channels of the pair and patches both mirror entries', async () => {
    vi.useFakeTimers();
    const calls: Array<[number, boolean]> = [];
    const device = initializedDevice({
      setOutputEnable: vi.fn(async (slot: number, enabled: boolean) => { calls.push([slot, enabled]); }),
      getAllParams: vi.fn(async () => parseBulkParams(makeBulk())),
    });
    dispatch({ t: 'synced', id: mintConnId(), session: makeReadySession(device) });
    liveMirror().replaceCurrent(fromBulkParams(createHardwareProfile(PlatformType.RP2350), parseBulkParams(makeBulk())));

    actions.setOutputPairEnabled(activeSession()!, 0, true);
    await vi.runAllTimersAsync();

    expect(calls).toEqual(expect.arrayContaining([[0, true], [1, true]]));
    expect(liveMirror().current?.outputs.find((o) => o.wireIndex === 0)?.enabled).toBe(true);
    expect(liveMirror().current?.outputs.find((o) => o.wireIndex === 1)?.enabled).toBe(true);
    vi.useRealTimers();
  });

  it('setOutputPairEnabled normalizes a half-enabled pair to a single state', async () => {
    vi.useFakeTimers();
    const device = initializedDevice({
      setOutputEnable: vi.fn(async () => {}),
      getAllParams: vi.fn(async () => parseBulkParams(makeBulk())),
    });
    dispatch({ t: 'synced', id: mintConnId(), session: makeReadySession(device) });
    liveMirror().replaceCurrent(fromBulkParams(createHardwareProfile(PlatformType.RP2350), parseBulkParams(makeBulk())));
    liveMirror().current!.outputs.find((o) => o.wireIndex === 2)!.enabled = true;
    liveMirror().current!.outputs.find((o) => o.wireIndex === 3)!.enabled = false;

    actions.setOutputPairEnabled(activeSession()!, 1, false);
    await vi.runAllTimersAsync();

    expect(liveMirror().current?.outputs.find((o) => o.wireIndex === 2)?.enabled).toBe(false);
    expect(liveMirror().current?.outputs.find((o) => o.wireIndex === 3)?.enabled).toBe(false);
    vi.useRealTimers();
  });
});

describe('crosspoint — granular per-cell write (whole-tuple merge)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    const bulk = parseBulkParams(makeBulk());
    dispatch({ t: 'synced', id: mintConnId(), session: makeReadySession({} as never) });
    liveMirror().replaceCurrent(fromBulkParams(createHardwareProfile(PlatformType.RP2350), bulk));
  });
  afterEach(() => { vi.useRealTimers(); });

  it('setCrosspointEnabled sends a full setMatrixRoute tuple via the per-item lane', async () => {
    const calls: Array<{ enabled: boolean; invert: boolean; gainDb: number }> = [];
    const device = initializedDevice({
      setMatrixRoute: vi.fn(async (_i: number, _o: number, cp) => { calls.push(cp); }),
      getAllParams: vi.fn(async () => parseBulkParams(makeBulk())),
    });
    dispatch({ t: 'synced', id: mintConnId(), session: makeReadySession(device) });
    liveMirror().replaceCurrent(fromBulkParams(createHardwareProfile(PlatformType.RP2350), parseBulkParams(makeBulk())));
    const route = liveMirror().current!.routes[0];
    const before = route.enabled;
    actions.setCrosspointEnabled(activeSession()!, route.inputIndex, route.outputWireIndex, !before);
    expect(liveMirror().current!.routes[0].enabled).toBe(before);    // not optimistic — unchanged until ack
    await vi.runAllTimersAsync();
    expect(liveMirror().current!.routes[0].enabled).toBe(!before);   // patched after ack
    expect(calls).toHaveLength(1);
    expect(calls[0].enabled).toBe(!before);

    // Explicit value, not a toggle: calling again with the same value must not flip it back.
    actions.setCrosspointEnabled(activeSession()!, route.inputIndex, route.outputWireIndex, !before);
    await vi.runAllTimersAsync();
    expect(liveMirror().current!.routes[0].enabled).toBe(!before);
  });

  it('sequential enable then gain edits on a cell each send the merged tuple', async () => {
    const calls: Array<{ enabled: boolean; invert: boolean; gainDb: number }> = [];
    const device = initializedDevice({
      setMatrixRoute: vi.fn(async (_i: number, _o: number, cp) => { calls.push(cp); }),
      getAllParams: vi.fn(async () => parseBulkParams(makeBulk())),
    });
    dispatch({ t: 'synced', id: mintConnId(), session: makeReadySession(device) });
    liveMirror().replaceCurrent(fromBulkParams(createHardwareProfile(PlatformType.RP2350), parseBulkParams(makeBulk())));
    const route = liveMirror().current!.routes[0];
    const beforeEnabled = route.enabled;
    actions.setCrosspointEnabled(activeSession()!, route.inputIndex, route.outputWireIndex, !beforeEnabled);
    await vi.runAllTimersAsync();
    actions.setCrosspointGain(activeSession()!, route.inputIndex, route.outputWireIndex, -6);
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
    dispatch({ t: 'synced', id: mintConnId(), session: makeReadySession(device) });
    liveMirror().replaceCurrent(fromBulkParams(createHardwareProfile(PlatformType.RP2350), parseBulkParams(makeBulk())));
    const route = liveMirror().current!.routes[0];
    const before = route.invert;
    actions.setCrosspointInvert(activeSession()!, route.inputIndex, route.outputWireIndex, !before);
    await vi.runAllTimersAsync();
    expect(calls).toHaveLength(1);
    expect(calls[0].invert).toBe(!before);
  });
});

// ── M3 — Per-band EQ bypass ───────────────────────────────────────────────────

describe('setBandBypass', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    const bulk = parseBulkParams(makeBulk());
    const device = initializedDevice({
      setBandBypass: vi.fn(async () => {}),
      getAllParams: vi.fn(async () => parseBulkParams(makeBulk())),
    });
    dispatch({ t: 'synced', id: mintConnId(), session: makeReadySession(device) });
    liveMirror().replaceCurrent(fromBulkParams(createHardwareProfile(PlatformType.RP2350), bulk));
  });
  afterEach(() => { vi.useRealTimers(); });

  it('is a no-op for an out-of-range band', async () => {
    const setBandBypassFn = vi.fn(async () => {});
    const device = initializedDevice({
      setBandBypass: setBandBypassFn,
      getAllParams: vi.fn(async () => parseBulkParams(makeBulk())),
    });
    dispatch({ t: 'synced', id: mintConnId(), session: makeReadySession(device) });
    liveMirror().replaceCurrent(fromBulkParams(createHardwareProfile(PlatformType.RP2350), parseBulkParams(makeBulk())));
    const ch = liveMirror().current!.channels[0].id;
    const n = liveMirror().current!.channels[0].filters.length;
    actions.setBandBypass(activeSession()!, ch, n + 5, true);
    await vi.runAllTimersAsync();
    expect(setBandBypassFn).not.toHaveBeenCalled();
  });
});

// ── M6 — DAC HW mute config ───────────────────────────────────────────────────

describe('setDacHwMute', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  function dacHarness() {
    const sent: DacHwMute[] = [];
    const setDacHwMuteFn = vi.fn(async (cfg: DacHwMute) => { sent.push(cfg); });
    // Echo device: GET returns the last accepted SET, per the firmware's
    // read-back-to-verify contract.
    const device = initializedDevice({
      setDacHwMute: setDacHwMuteFn,
      getDacHwMute: vi.fn(async () => sent[sent.length - 1]),
      getAllParams: vi.fn(async () => parseBulkParams(makeBulk())),
    });
    const bulk = parseBulkParams(makeBulk());
    dispatch({ t: 'synced', id: mintConnId(), session: makeReadySession(device) });
    liveMirror().replaceCurrent(fromBulkParams(createHardwareProfile(PlatformType.RP2350), bulk));
    return { sent, setDacHwMuteFn };
  }

  it('patches dacHwMute optimistically and settles on the device echo', async () => {
    const { setDacHwMuteFn } = dacHarness();
    const cfg: DacHwMute = { enabled: true, activeLow: true, pin: 20, holdMs: 50, releaseMs: 10 };
    actions.setDacHwMute(activeSession()!, cfg);
    expect(liveMirror().current?.dacHwMute).toEqual(cfg);   // optimistic
    await vi.runAllTimersAsync();
    expect(liveMirror().current?.dacHwMute).toEqual(cfg);   // echo agrees
    expect(setDacHwMuteFn).toHaveBeenCalledWith(cfg);
  });

  it('merges a second quick edit over the first optimistic patch (no stale-struct revert)', async () => {
    const { sent } = dacHarness();
    actions.setDacHwMute(activeSession()!, { activeLow: true });
    actions.setDacHwMute(activeSession()!, { holdMs: 50 });   // inside the first ack window
    await vi.runAllTimersAsync();
    expect(sent[1]).toMatchObject({ activeLow: true, holdMs: 50 });
    expect(liveMirror().current?.dacHwMute).toMatchObject({ activeLow: true, holdMs: 50 });
  });

  it('clamps holdMs into the firmware range when enabling', async () => {
    const { sent } = dacHarness();
    actions.setDacHwMute(activeSession()!, { enabled: true });   // virgin device: holdMs 0
    await vi.runAllTimersAsync();
    expect(sent[0].holdMs).toBeGreaterThanOrEqual(1);
  });

  it('does not hold the session queue across the deferred-apply wait', async () => {
    const { setDacHwMuteFn } = dacHarness();
    const s = activeSession()!;
    actions.setDacHwMute(s, { enabled: true, pin: 6 });
    // Let the SET transfer settle but stay inside the 200 ms apply window.
    await vi.advanceTimersByTimeAsync(50);
    expect(setDacHwMuteFn).toHaveBeenCalled();
    // Another op enqueued mid-wait must run without waiting out the window.
    let ran = false;
    const other = s.queue.run(async () => { ran = true; });
    await vi.advanceTimersByTimeAsync(0);
    await other;
    expect(ran).toBe(true);
    await vi.runAllTimersAsync();
  });

  it('warns and reverts when the device swallows an enable', async () => {
    const rejected: DacHwMute = { enabled: false, activeLow: false, pin: 0, holdMs: 0, releaseMs: 0 };
    const device = initializedDevice({
      setDacHwMute: vi.fn(async () => {}),
      getDacHwMute: vi.fn(async () => rejected),
      getAllParams: vi.fn(async () => parseBulkParams(makeBulk())),
    });
    const bulk = parseBulkParams(makeBulk());
    dispatch({ t: 'synced', id: mintConnId(), session: makeReadySession(device) });
    liveMirror().replaceCurrent(fromBulkParams(createHardwareProfile(PlatformType.RP2350), bulk));
    clearNotices();
    actions.setDacHwMute(activeSession()!, { enabled: true, pin: 6 });
    // Step just past the deferred-apply wait; running ALL timers would also
    // expire the warn notice's TTL before it can be observed.
    await vi.advanceTimersByTimeAsync(250);
    expect(liveMirror().current?.dacHwMute).toEqual(rejected);
    expect(notices.list.some((n) => n.kind === 'warn' && /DAC HW mute/i.test(n.message))).toBe(true);
  });
});

// ── M1 — Input source switch ─────────────────────────────────────────────────

describe('setInputSource', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('patches inputConfig.source after ack and pushes an info notice', async () => {
    const setInputSourceFn = vi.fn(async () => {});
    const device = initializedDevice({
      setInputSource: setInputSourceFn,
      getAllParams: vi.fn(async () => parseBulkParams(makeBulk())),
    });
    const bulk = parseBulkParams(makeBulk());
    dispatch({ t: 'synced', id: mintConnId(), session: makeReadySession(device) });
    liveMirror().replaceCurrent(fromBulkParams(createHardwareProfile(PlatformType.RP2350), bulk));
    clearNotices();
    actions.setInputSource(activeSession()!, AudioInputSource.Spdif);
    // Notice rides the ack: nothing surfaces until the send settles.
    expect(notices.list.some((n) => n.kind === 'info' && /input source/i.test(n.message))).toBe(false);
    // Settle the write's microtasks without running the notice-expiry timer.
    await vi.advanceTimersByTimeAsync(0);
    expect(notices.list.some((n) => n.kind === 'info' && /input source/i.test(n.message))).toBe(true);
    expect(liveMirror().current?.inputConfig.source).toBe(AudioInputSource.Spdif);
    expect(setInputSourceFn).toHaveBeenCalledWith(AudioInputSource.Spdif);
  });

  it('drops the retained S/PDIF RX status frame on a source switch', async () => {
    const device = initializedDevice({
      setInputSource: vi.fn(async () => {}),
      getAllParams: vi.fn(async () => parseBulkParams(makeBulk())),
    });
    const bulk = parseBulkParams(makeBulk());
    dispatch({ t: 'synced', id: mintConnId(), session: makeReadySession(device) });
    liveMirror().replaceCurrent(fromBulkParams(createHardwareProfile(PlatformType.RP2350), bulk));
    activeSession()!.telemetry.spdifRxStatus = {
      state: 2, inputSource: 1, lockCount: 3, lossCount: 0,
      sampleRate: 48000, parityErrors: 0, fifoFillPct: 50,
    };
    actions.setInputSource(activeSession()!, AudioInputSource.Spdif);
    await vi.advanceTimersByTimeAsync(0);
    expect(activeSession()!.telemetry.spdifRxStatus).toBeNull();
  });
});

describe('output config verbs', () => {
  beforeEach(async () => {
    await bootMock('rp2350');
    clearNotices();
  });

  it('setOutputDataPin success patches draft.outputPins without discarding other edits', async () => {
    const before = liveMirror().current!.masterVolumeDb;
    actions.setOutputDataPin(activeSession()!, 0, 16);
    await flushAllWrites();
    expect(liveMirror().current!.outputPins[0]).toBe(16);
    expect(liveMirror().current!.masterVolumeDb).toBe(before);
  });

  it('setOutputDataPin failure leaves outputPins unchanged and toasts the device message', async () => {
    // pin 7 is in use by pinOutputIndex 1 — mock returns PinInUse
    const pinsBefore = liveMirror().current!.outputPins.slice();
    actions.setOutputDataPin(activeSession()!, 0, 7);
    await flushAllWrites();
    expect(liveMirror().current!.outputPins).toEqual(pinsBefore);
    expect(notices.list).toHaveLength(1);
    expect(notices.list[0].message).toContain('in use');
  });

  it('setOutputType updates draft.i2s.outputSlotTypes', async () => {
    actions.setOutputType(activeSession()!, 0, 1);
    await flushAllWrites();
    expect(liveMirror().current!.i2s.outputSlotTypes[0]).toBe(1);
  });

  test('setI2sBckPin success patches draft.i2s.bckPin', async () => {
    actions.setI2sBckPin(activeSession()!, 16);
    await flushAllWrites();
    expect(liveMirror().current!.i2s.bckPin).toBe(16);
  });

  test('setMckEnabled success patches draft.i2s.mckEnabled', async () => {
    actions.setMckEnabled(activeSession()!, true);
    await flushAllWrites();
    expect(liveMirror().current!.i2s.mckEnabled).toBe(true);
  });

  test('setI2sClockMode success patches draft.inputConfig.i2sClockMode', async () => {
    actions.setI2sClockMode(activeSession()!, 1);
    await flushAllWrites();
    expect(liveMirror().current!.inputConfig.i2sClockMode).toBe(1);
  });

  test('setI2sClockPinMode success patches draft.i2s.clockPinMode', async () => {
    actions.setI2sClockPinMode(activeSession()!, 1);
    await flushAllWrites();
    expect(liveMirror().current!.i2s.clockPinMode).toBe(1);
  });

  test('setI2sBckPinSlave success patches draft.i2s.bckPinSlave', async () => {
    actions.setI2sBckPinSlave(activeSession()!, 21);
    await flushAllWrites();
    expect(liveMirror().current!.i2s.bckPinSlave).toBe(21);
  });

  it('requests a non-eager reconcile on a successful config write', async () => {
    activeSession()!.mirror.consumeReconcile(); // clear anything pending from boot
    actions.setI2sBckPin(activeSession()!, 16);
    await flushAllWrites();
    expect(activeSession()!.mirror.peekReconcile()).toEqual({ wanted: true, eager: false });
  });

  it('factoryResetDevice toasts completion on success', async () => {
    await factoryResetDevice();
    expect(notices.list.some((n) => n.kind === 'info' && n.message.includes('Factory reset complete'))).toBe(true);
  });
});

describe('ADAT output verbs (fw V17+, RP2350)', () => {
  beforeEach(async () => {
    await bootMock('rp2350', { wireVersion: 17, fwVersion: { major: 1, minor: 1, patch: 5 } });
    clearNotices();
  });

  it('setAdatEnable success patches draft.adat.enabled', async () => {
    const ok = await actions.setAdatEnable(activeSession()!, true);
    expect(ok).toBe(true);
    expect(liveMirror().current!.adat.enabled).toBe(true);
  });

  it('setAdatEnable(false) clears any stale adatStatus telemetry', async () => {
    await actions.setAdatEnable(activeSession()!, true);
    activeSession()!.telemetry.adatStatus = { enabled: true, active: true, pin: 12, rateOk: true, resyncCount: 2, slipCount: 1 };
    const ok = await actions.setAdatEnable(activeSession()!, false);
    expect(ok).toBe(true);
    expect(liveMirror().current!.adat.enabled).toBe(false);
    expect(activeSession()!.telemetry.adatStatus).toBeNull();
  });

  it('setAdatPin success patches draft.adat.pin', async () => {
    const ok = await actions.setAdatPin(activeSession()!, 20);
    expect(ok).toBe(true);
    expect(liveMirror().current!.adat.pin).toBe(20);
  });

  it('setAdatPin with the 0xFF reset sentinel skips the mirror patch and requests an eager reconcile', async () => {
    activeSession()!.mirror.consumeReconcile(); // clear anything pending from boot
    const pinBefore = liveMirror().current!.adat.pin;
    const ok = await actions.setAdatPin(activeSession()!, Wire.Const.PIN_RESET_TO_DEFAULT);
    expect(ok).toBe(true);
    expect(liveMirror().current!.adat.pin).toBe(pinBefore);
    expect(activeSession()!.mirror.peekReconcile()).toEqual({ wanted: true, eager: true });
  });
});

describe('ADAT output verbs — device rejection (RP2040 has no ADAT hardware)', () => {
  it('both verbs leave the mirror untouched and toast the device message', async () => {
    await bootMock('rp2040', { wireVersion: 17, fwVersion: { major: 1, minor: 1, patch: 5 } });
    clearNotices();
    const pinBefore = liveMirror().current!.adat.pin;
    expect(await actions.setAdatEnable(activeSession()!, true)).toBe(false);
    expect(await actions.setAdatPin(activeSession()!, 20)).toBe(false);
    expect(liveMirror().current!.adat.enabled).toBe(false);
    expect(liveMirror().current!.adat.pin).toBe(pinBefore);
    expect(notices.list).toHaveLength(2);
  });
});

describe('ADAT input verbs (fw V24+, RP2350)', () => {
  beforeEach(async () => {
    await bootMock('rp2350', { wireVersion: 24, fwVersion: { major: 1, minor: 1, patch: 5 } });
    clearNotices();
  });

  it('setAdatInputEnable success patches draft.inputConfig.adatInputEnabled and clears stale telemetry on disable', async () => {
    await actions.setAdatInputPin(activeSession()!, 20);   // enable requires a stored pin
    const enabled = await actions.setAdatInputEnable(activeSession()!, true);
    expect(enabled).toBe(true);
    expect(liveMirror().current!.inputConfig.adatInputEnabled).toBe(true);

    activeSession()!.telemetry.adatInputStatus = {
      state: 3, clockMode: 0, enabled: true, pin: 20, rateOk: true,
      lockCount: 1, lossCount: 0, slipCount: 0, headerErr: 0, detectedRateHz: 48000, measuredHz: 48000,
    };
    const disabled = await actions.setAdatInputEnable(activeSession()!, false);
    expect(disabled).toBe(true);
    expect(liveMirror().current!.inputConfig.adatInputEnabled).toBe(false);
    expect(activeSession()!.telemetry.adatInputStatus).toBeNull();
  });

  it('setAdatInputPin patches draft.inputConfig.adatInputPin, including the 0xFF reset clearing it to 0', async () => {
    const ok = await actions.setAdatInputPin(activeSession()!, 20);
    expect(ok).toBe(true);
    expect(liveMirror().current!.inputConfig.adatInputPin).toBe(20);

    const cleared = await actions.setAdatInputPin(activeSession()!, Wire.Const.PIN_RESET_TO_DEFAULT);
    expect(cleared).toBe(true);
    expect(liveMirror().current!.inputConfig.adatInputPin).toBe(0);
  });

  it('setAdatInputClockMode patches draft.inputConfig.adatInputClockMode', async () => {
    const ok = await actions.setAdatInputClockMode(activeSession()!, 1);
    expect(ok).toBe(true);
    expect(liveMirror().current!.inputConfig.adatInputClockMode).toBe(1);
  });
});

describe('ADAT input verbs — device rejection (RP2040 has no ADAT hardware)', () => {
  it('both verbs leave the mirror untouched and toast the device message', async () => {
    await bootMock('rp2040', { wireVersion: 24, fwVersion: { major: 1, minor: 1, patch: 5 } });
    clearNotices();
    const pinBefore = liveMirror().current!.inputConfig.adatInputPin;
    expect(await actions.setAdatInputEnable(activeSession()!, true)).toBe(false);
    expect(await actions.setAdatInputPin(activeSession()!, 20)).toBe(false);
    expect(liveMirror().current!.inputConfig.adatInputEnabled).toBe(false);
    expect(liveMirror().current!.inputConfig.adatInputPin).toBe(pinBefore);
    expect(notices.list).toHaveLength(2);
  });
});

// ── V16 — external control interfaces ────────────────────────────────────────

describe('setUartControlConfig', () => {
  const cfg: UartControlConfig = { enabled: true, txPin: 12, rxPin: 13, notifyEnabled: false, baud: 115200 };

  function harness(setResult: { result: Result<void, PinConfigResult>; status: ControlIfaceStatus }) {
    const device = initializedDevice({
      setUartControlConfig: vi.fn(async () => setResult),
    });
    dispatch({ t: 'synced', id: mintConnId(), session: makeReadySession(device) });
    return activeSession()!;
  }

  it('patches ctrlIfaces.uart and stores the fresh status on a successful set', async () => {
    const status = { uartLastStatus: 0, uartLive: true, i2cLastStatus: 0, i2cLive: false, protoVersion: 1 };
    const s = harness({ result: Result.ok(), status });
    actions.setUartControlConfig(s, cfg);
    await flushAllWrites();
    expect(s.ctrlIfaces.uart).toEqual(cfg);
    expect(s.ctrlIfaces.status).toEqual(status);
  });

  it('on a rejected set, leaves ctrlIfaces.uart untouched but stores the status and warns with the decoded message', async () => {
    const status = { uartLastStatus: PinConfigResult.InvalidParam, uartLive: false, i2cLastStatus: 0, i2cLive: false, protoVersion: 1 };
    const s = harness({ result: Result.fail(PinConfigResult.InvalidParam, 'value out of range'), status });
    clearNotices();
    actions.setUartControlConfig(s, cfg);
    await flushAllWrites();
    expect(s.ctrlIfaces.uart).toBeNull();
    expect(s.ctrlIfaces.status).toEqual(status);
    expect(notices.list.some((n) => n.kind === 'warn' && /out of range/.test(n.message))).toBe(true);
  });
});

