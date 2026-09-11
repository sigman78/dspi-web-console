import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as actions from './systemActions';
import { notices, clearNotices, dispatch, mintConnId, makeReadySession, activeSession, resetAppState } from '@/state';
import type { DspDevice } from '@/device/DspDevice';
import { parseBulkParams } from '@/protocol';
import { PlatformType, createHardwareProfile, type DacHwMute } from '@/domain';
import { fromBulkParams } from '@/protocol/snapshotCodec';
import { deriveCapabilities } from '@/protocol/capabilities';
import { makeBulk } from '@test/fixtures/bulkFixtures';

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

// Thin verb: sends one value to one device method and patches one mirror
// field once the send settles. Same table shape as the other split action
// test files, kept for consistency even with a single row.
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
  { name: 'setLgSoundSyncEnabled', method: 'setLgSoundSyncEnabled', mirrorPath: 'lgSoundSync.enabled', lane: 'write', makeStub: (fn) => ({ setLgSoundSyncEnabled: fn }), invoke: () => actions.setLgSoundSyncEnabled(activeSession()!, true), expectedArgs: () => [true], read: () => liveMirror().current!.lgSoundSync?.enabled, expected: true },
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

// applySysClock/refreshSysClock/testDacHwMute/resetBufferStats/enterBootloader/
// clearClips have no dedicated unit coverage (none did in actions.test.ts either).
