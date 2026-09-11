import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as actions from './mixerActions';
import { dispatch, mintConnId, makeReadySession, activeSession, resetAppState } from '@/state';
import { parseBulkParams } from '@/protocol';
import {
  PlatformType, createHardwareProfile, type ChannelId, matrixColumns,
} from '@/domain';
import { fromBulkParams } from '@/protocol/snapshotCodec';
import { deriveCapabilities } from '@/protocol/capabilities';
import { makeBulk } from '@test/fixtures/bulkFixtures';
import type { DspDevice } from '@/device/DspDevice';
import { bootMock } from './boot';

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

function makeSnapshot(platform: PlatformType = PlatformType.RP2350) {
  const bulk = parseBulkParams(makeBulk(
    { platformId: platform === PlatformType.RP2350 ? 1 : 0 },
  ));
  return fromBulkParams(createHardwareProfile(platform), bulk);
}

const cancelWrites = () => { const s = activeSession(); if (s) s.writes.cancel(); };
afterEach(() => { activeSession()?.dispose(); cancelWrites(); resetAppState(); });

const liveMirror = () => activeSession()!.mirror;

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
  { name: 'setOutputDelay', method: 'setOutputDelay', mirrorPath: 'outputs[0].delayMs', lane: 'write', makeStub: (fn) => ({ setOutputDelay: fn }), invoke: () => actions.setOutputDelay(activeSession()!, out0().wireIndex, 5), expectedArgs: () => [out0().wireIndex, 5], read: () => out0().delayMs, expected: 5 },
  { name: 'setOutputGain', method: 'setOutputGain', mirrorPath: 'outputs[0].gainDb', lane: 'write', makeStub: (fn) => ({ setOutputGain: fn }), invoke: () => actions.setOutputGain(activeSession()!, out0().wireIndex, -6), expectedArgs: () => [out0().wireIndex, -6], read: () => out0().gainDb, expected: -6 },
  { name: 'setInputPreamp', method: 'setInputPreamp', mirrorPath: 'inputPreampDb[1]', lane: 'scrub', makeStub: (fn) => ({ setInputPreamp: fn }), invoke: () => actions.setInputPreamp(activeSession()!, 1, -4), expectedArgs: () => [1, -4], read: () => liveMirror().current!.inputPreampDb[1], expected: -4 },
  { name: 'setOutputEnabled', method: 'setOutputEnable', mirrorPath: 'outputs[0].enabled', lane: 'write', makeStub: (fn) => ({ setOutputEnable: fn }), invoke: () => actions.setOutputEnabled(activeSession()!, out0().wireIndex, false), expectedArgs: () => [out0().wireIndex, false], read: () => out0().enabled, expected: false },
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
