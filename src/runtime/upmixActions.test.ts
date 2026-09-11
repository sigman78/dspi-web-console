import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as actions from './upmixActions';
import { dispatch, mintConnId, makeReadySession, activeSession, resetAppState } from '@/state';
import { parseBulkParams } from '@/protocol';
import { PlatformType, createHardwareProfile } from '@/domain';
import { fromBulkParams } from '@/protocol/snapshotCodec';
import { deriveCapabilities } from '@/protocol/capabilities';
import { makeBulk } from '@test/fixtures/bulkFixtures';
import type { DspDevice } from '@/device/DspDevice';

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

const cancelWrites = () => { const s = activeSession(); if (s) s.writes.cancel(); };
afterEach(() => { activeSession()?.dispose(); cancelWrites(); resetAppState(); });

const liveMirror = () => activeSession()!.mirror;

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
