import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as actions from './processingActions';
import { dispatch, mintConnId, makeReadySession, activeSession, resetAppState } from '@/state';
import { parseBulkParams } from '@/protocol';
import {
  PlatformType, createHardwareProfile, CrossfeedPreset, LevellerSpeed,
} from '@/domain';
import { fromBulkParams } from '@/protocol/snapshotCodec';
import { deriveCapabilities } from '@/protocol/capabilities';
import { makeBulk } from '@test/fixtures/bulkFixtures';
import type { DspDevice } from '@/device/DspDevice';

const testHardware = createHardwareProfile(PlatformType.RP2350);

// Builds a DspDevice stub with identity defaults. Any method can be overridden.
function initializedDevice(methods: Partial<DspDevice>): DspDevice {
  const capabilities = deriveCapabilities({
    fw: { major: 1, minor: 1, patch: 4 }, wireVersion: 10, payloadLength: 2960, platformId: 1,
  });
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

const cancelWrites = () => { const s = activeSession(); if (s) s.writes.cancel(); };
afterEach(() => { activeSession()?.dispose(); cancelWrites(); resetAppState(); });

const liveMirror = () => activeSession()!.mirror;

describe('setSubharmEnabled — headroom telemetry', () => {
  function setup() {
    const device = initializedDevice({
      setSubharmEnabled: vi.fn(async () => {}),
      getAllParams: vi.fn(async () => parseBulkParams(makeBulk())),
    });
    dispatch({ t: 'synced', id: mintConnId(), session: makeReadySession(device) });
    liveMirror().replaceCurrent(fromBulkParams(testHardware, parseBulkParams(makeBulk())));
    return activeSession()!;
  }

  it('zeroes subharmHeadroomDb on disable (fw reports 0 while disabled; the poll stops)', async () => {
    vi.useFakeTimers();
    const s = setup();
    s.telemetry.subharmHeadroomDb = 4.2;
    s.telemetry.lastSubharmMs = 999;

    actions.setSubharmEnabled(s, false);
    await vi.runAllTimersAsync();

    expect(s.telemetry.subharmHeadroomDb).toBe(0);
    vi.useRealTimers();
  });

  it('nulls subharmHeadroomDb on enable (not read yet) and forces a re-read', async () => {
    vi.useFakeTimers();
    const s = setup();
    s.telemetry.subharmHeadroomDb = 0;
    s.telemetry.lastSubharmMs = 999;

    actions.setSubharmEnabled(s, true);
    await vi.runAllTimersAsync();

    expect(s.telemetry.subharmHeadroomDb).toBeNull();
    expect(s.telemetry.lastSubharmMs).toBe(0);
    vi.useRealTimers();
  });
});

describe('reserveSubharmHeadroom', () => {
  // Route input 0 into an enabled output slot 0 so it's a "feeding" input --
  // subharmReservePlan no longer falls back to every input, so the plan is
  // empty unless a real route qualifies.
  function feedingSnapshot(inputPreampDb: [number, number]) {
    const snap = fromBulkParams(testHardware, parseBulkParams(makeBulk()));
    snap.inputPreampDb = inputPreampDb;
    snap.outputs.find((o) => o.wireIndex === 0)!.enabled = true;
    snap.routes.find((r) => r.inputIndex === 0 && r.outputWireIndex === 0)!.enabled = true;
    return snap;
  }

  it('lowers only the input above the headroom line, to exactly -headroomDb', async () => {
    vi.useFakeTimers();
    const setInputPreamp = vi.fn(async () => {});
    const device = initializedDevice({
      setInputPreamp,
      getAllParams: vi.fn(async () => parseBulkParams(makeBulk())),
    });
    dispatch({ t: 'synced', id: mintConnId(), session: makeReadySession(device) });
    liveMirror().replaceCurrent(feedingSnapshot([0, -6]));
    const s = activeSession()!;
    s.telemetry.subharmHeadroomDb = 4.2;

    actions.reserveSubharmHeadroom(s);
    await vi.runAllTimersAsync();

    expect(setInputPreamp).toHaveBeenCalledTimes(1);
    expect(setInputPreamp).toHaveBeenCalledWith(0, -4.2);
    expect(liveMirror().current!.inputPreampDb).toEqual([-4.2, -6]);
    vi.useRealTimers();
  });

  it('is a no-op when the feeding input is already at or below the line', async () => {
    vi.useFakeTimers();
    const setInputPreamp = vi.fn(async () => {});
    const device = initializedDevice({
      setInputPreamp,
      getAllParams: vi.fn(async () => parseBulkParams(makeBulk())),
    });
    dispatch({ t: 'synced', id: mintConnId(), session: makeReadySession(device) });
    liveMirror().replaceCurrent(feedingSnapshot([-10, -10]));
    const s = activeSession()!;
    s.telemetry.subharmHeadroomDb = 4.2;

    actions.reserveSubharmHeadroom(s);
    await vi.runAllTimersAsync();

    expect(setInputPreamp).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('is a no-op when nothing feeds a masked output (no all-inputs fallback)', async () => {
    vi.useFakeTimers();
    const setInputPreamp = vi.fn(async () => {});
    const device = initializedDevice({
      setInputPreamp,
      getAllParams: vi.fn(async () => parseBulkParams(makeBulk())),
    });
    dispatch({ t: 'synced', id: mintConnId(), session: makeReadySession(device) });
    const snap = fromBulkParams(testHardware, parseBulkParams(makeBulk()));
    snap.inputPreampDb = [0, 0];   // both above any plausible line, but no route/output qualifies
    liveMirror().replaceCurrent(snap);
    const s = activeSession()!;
    s.telemetry.subharmHeadroomDb = 4.2;

    actions.reserveSubharmHeadroom(s);
    await vi.runAllTimersAsync();

    expect(setInputPreamp).not.toHaveBeenCalled();
    vi.useRealTimers();
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
  { name: 'setCrossfeedPreset', method: 'setCrossfeedPreset', mirrorPath: 'crossfeed.preset', lane: 'write', makeStub: (fn) => ({ setCrossfeedPreset: fn }), invoke: () => actions.setCrossfeedPreset(activeSession()!, CrossfeedPreset.Preset2), expectedArgs: () => [CrossfeedPreset.Preset2], read: () => liveMirror().current!.crossfeed.preset, expected: CrossfeedPreset.Preset2 },
  { name: 'setLevellerSpeed', method: 'setLevellerSpeed', mirrorPath: 'leveller.speed', lane: 'write', makeStub: (fn) => ({ setLevellerSpeed: fn }), invoke: () => actions.setLevellerSpeed(activeSession()!, LevellerSpeed.Fast), expectedArgs: () => [LevellerSpeed.Fast], read: () => liveMirror().current!.leveller?.speed, expected: LevellerSpeed.Fast },
  { name: 'setLevellerAmount', method: 'setLevellerAmount', mirrorPath: 'leveller.amount', lane: 'scrub', makeStub: (fn) => ({ setLevellerAmount: fn }), invoke: () => actions.setLevellerAmount(activeSession()!, 33), expectedArgs: () => [33], read: () => liveMirror().current!.leveller?.amount, expected: 33 },
  { name: 'setLevellerMasks', method: 'setLevellerMasks', mirrorPath: 'leveller.detectorMask', lane: 'write', makeStub: (fn) => ({ setLevellerMasks: fn }), invoke: () => actions.setLevellerMasks(activeSession()!, 0x03, 0x05), expectedArgs: () => [0x03, 0x05], read: () => liveMirror().current!.leveller?.detectorMask, expected: 0x03 },
  { name: 'setLoudnessOutputMask', method: 'setLoudnessOutputMask', mirrorPath: 'loudness.outputMask', lane: 'write', makeStub: (fn) => ({ setLoudnessOutputMask: fn }), invoke: () => actions.setLoudnessOutputMask(activeSession()!, 0x00F0), expectedArgs: () => [0x00F0], read: () => liveMirror().current!.loudness.outputMask, expected: 0x00F0 },
  { name: 'setCrossfeedOutputPairs', method: 'setCrossfeedOutputPairs', mirrorPath: 'crossfeed.outputPairMask', lane: 'write', makeStub: (fn) => ({ setCrossfeedOutputPairs: fn }), invoke: () => actions.setCrossfeedOutputPairs(activeSession()!, 0x0D), expectedArgs: () => [0x0D], read: () => liveMirror().current!.crossfeed.outputPairMask, expected: 0x0D },
  { name: 'setLoudnessEnabled', method: 'setLoudnessEnabled', mirrorPath: 'loudness.enabled', lane: 'write', makeStub: (fn) => ({ setLoudnessEnabled: fn }), invoke: () => actions.setLoudnessEnabled(activeSession()!, true), expectedArgs: () => [true], read: () => liveMirror().current!.loudness.enabled, expected: true },
  { name: 'setLoudnessRefSpl', method: 'setLoudnessRefSpl', mirrorPath: 'loudness.refSpl', lane: 'scrub', makeStub: (fn) => ({ setLoudnessRefSpl: fn }), invoke: () => actions.setLoudnessRefSpl(activeSession()!, 90), expectedArgs: () => [90], read: () => liveMirror().current!.loudness.refSpl, expected: 90 },
  { name: 'setLoudnessIntensityPct', method: 'setLoudnessIntensity', mirrorPath: 'loudness.intensityPct', lane: 'scrub', makeStub: (fn) => ({ setLoudnessIntensity: fn }), invoke: () => actions.setLoudnessIntensityPct(activeSession()!, 50), expectedArgs: () => [50], read: () => liveMirror().current!.loudness.intensityPct, expected: 50 },
  { name: 'setPsybassEnabled', method: 'setPsybassEnabled', mirrorPath: 'psybass.enabled', lane: 'write', makeStub: (fn) => ({ setPsybassEnabled: fn }), invoke: () => actions.setPsybassEnabled(activeSession()!, true), expectedArgs: () => [true], read: () => liveMirror().current!.psybass.enabled, expected: true },
  { name: 'setPsybassCutoff', method: 'setPsybassCutoff', mirrorPath: 'psybass.cutoffHz', lane: 'scrub', makeStub: (fn) => ({ setPsybassCutoff: fn }), invoke: () => actions.setPsybassCutoff(activeSession()!, 120), expectedArgs: () => [120], read: () => liveMirror().current!.psybass.cutoffHz, expected: 120 },
  { name: 'setPsybassHarmonics', method: 'setPsybassHarmonics', mirrorPath: 'psybass.harmonicsDb', lane: 'scrub', makeStub: (fn) => ({ setPsybassHarmonics: fn }), invoke: () => actions.setPsybassHarmonics(activeSession()!, 4.5), expectedArgs: () => [4.5], read: () => liveMirror().current!.psybass.harmonicsDb, expected: 4.5 },
  { name: 'setPsybassDrive', method: 'setPsybassDrive', mirrorPath: 'psybass.driveDb', lane: 'scrub', makeStub: (fn) => ({ setPsybassDrive: fn }), invoke: () => actions.setPsybassDrive(activeSession()!, 9), expectedArgs: () => [9], read: () => liveMirror().current!.psybass.driveDb, expected: 9 },
  { name: 'setPsybassCharacter', method: 'setPsybassCharacter', mirrorPath: 'psybass.characterPct', lane: 'scrub', makeStub: (fn) => ({ setPsybassCharacter: fn }), invoke: () => actions.setPsybassCharacter(activeSession()!, 75), expectedArgs: () => [75], read: () => liveMirror().current!.psybass.characterPct, expected: 75 },
  { name: 'setPsybassOriginal', method: 'setPsybassOriginal', mirrorPath: 'psybass.originalDb', lane: 'scrub', makeStub: (fn) => ({ setPsybassOriginal: fn }), invoke: () => actions.setPsybassOriginal(activeSession()!, -12), expectedArgs: () => [-12], read: () => liveMirror().current!.psybass.originalDb, expected: -12 },
  { name: 'setPsybassOutputMask', method: 'setPsybassMask', mirrorPath: 'psybass.outputMask', lane: 'write', makeStub: (fn) => ({ setPsybassMask: fn }), invoke: () => actions.setPsybassOutputMask(activeSession()!, 0x00F0), expectedArgs: () => [0x00F0], read: () => liveMirror().current!.psybass.outputMask, expected: 0x00F0 },
  { name: 'setSubharmEnabled', method: 'setSubharmEnabled', mirrorPath: 'subharm.enabled', lane: 'write', makeStub: (fn) => ({ setSubharmEnabled: fn }), invoke: () => actions.setSubharmEnabled(activeSession()!, true), expectedArgs: () => [true], read: () => liveMirror().current!.subharm.enabled, expected: true },
  { name: 'setSubharmLow', method: 'setSubharmLow', mirrorPath: 'subharm.lowDb', lane: 'scrub', makeStub: (fn) => ({ setSubharmLow: fn }), invoke: () => actions.setSubharmLow(activeSession()!, -6), expectedArgs: () => [-6], read: () => liveMirror().current!.subharm.lowDb, expected: -6 },
  { name: 'setSubharmHigh', method: 'setSubharmHigh', mirrorPath: 'subharm.highDb', lane: 'scrub', makeStub: (fn) => ({ setSubharmHigh: fn }), invoke: () => actions.setSubharmHigh(activeSession()!, 2), expectedArgs: () => [2], read: () => liveMirror().current!.subharm.highDb, expected: 2 },
  { name: 'setSubharmBoost', method: 'setSubharmBoost', mirrorPath: 'subharm.boostDb', lane: 'scrub', makeStub: (fn) => ({ setSubharmBoost: fn }), invoke: () => actions.setSubharmBoost(activeSession()!, 3), expectedArgs: () => [3], read: () => liveMirror().current!.subharm.boostDb, expected: 3 },
  { name: 'setSubharmOutputMask', method: 'setSubharmMask', mirrorPath: 'subharm.outputMask', lane: 'write', makeStub: (fn) => ({ setSubharmMask: fn }), invoke: () => actions.setSubharmOutputMask(activeSession()!, 0x00F0), expectedArgs: () => [0x00F0], read: () => liveMirror().current!.subharm.outputMask, expected: 0x00F0 },
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
