import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as actions from './eqActions';
import { dispatch, mintConnId, makeReadySession, activeSession, resetAppState } from '@/state';
import { parseBulkParams } from '@/protocol';
import {
  FilterType, PlatformType, createHardwareProfile, type FilterParams,
} from '@/domain';
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

// Module-scoped state leaks across tests in this file and must be reset after
// every test (see actions.test.ts's original note on the rAF polling loop and
// the write-lane registry).
const cancelWrites = () => { const s = activeSession(); if (s) s.writes.cancel(); };
afterEach(() => { activeSession()?.dispose(); cancelWrites(); resetAppState(); });

const liveMirror = () => activeSession()!.mirror;

describe('copyEqBands', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    const bulk = parseBulkParams(makeBulk({ masterVolumeDb: 0 }));
    dispatch({ t: 'synced', id: mintConnId(), session: makeReadySession({} as never) });
    liveMirror().replaceCurrent(fromBulkParams(createHardwareProfile(PlatformType.RP2350), bulk));
  });
  afterEach(() => { vi.useRealTimers(); });

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

  it('throws on an out-of-range band and never sends the wire command', async () => {
    const setBandBypassFn = vi.fn(async () => {});
    const device = initializedDevice({
      setBandBypass: setBandBypassFn,
      getAllParams: vi.fn(async () => parseBulkParams(makeBulk())),
    });
    dispatch({ t: 'synced', id: mintConnId(), session: makeReadySession(device) });
    liveMirror().replaceCurrent(fromBulkParams(createHardwareProfile(PlatformType.RP2350), parseBulkParams(makeBulk())));
    const ch = liveMirror().current!.channels[0].id;
    const n = liveMirror().current!.channels[0].filters.length;
    expect(() => actions.setBandBypass(activeSession()!, ch, n + 5, true)).toThrow();
    await vi.runAllTimersAsync();
    expect(setBandBypassFn).not.toHaveBeenCalled();
  });
});

// setXoverBand / setXoverBypass have no dedicated unit coverage: XoverPanel.svelte
// only ever calls them with an in-range band from the live channel it renders.
