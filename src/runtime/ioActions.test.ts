import { describe, it, test, expect, vi, beforeEach, afterEach } from 'vitest';
import * as actions from './ioActions';
import { factoryResetDevice } from './deviceService';
import { renamePresetSlot } from './presets';
import * as State from '@/state';
import { bootMock } from './boot';
import type { DspDevice } from '@/device/DspDevice';
import { parseBulkParams, Wire } from '@/protocol';
import { type PresetSlot, PlatformType, createHardwareProfile, AudioInputSource } from '@/domain';
import { fromBulkParams } from '@/protocol/snapshotCodec';
import { deriveCapabilities } from '@/protocol/capabilities';
import { makeBulk } from '@test/fixtures/bulkFixtures';
import { flushAllWrites as flushAllWritesFor } from './writes.svelte';

const cancelWrites = () => { const s = State.activeSession(); if (s) s.writes.cancel(); };
const flushAllWrites = () => flushAllWritesFor(State.activeSession()!);

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

afterEach(() => { State.activeSession()?.dispose(); cancelWrites(); State.resetAppState(); });

const liveMirror = () => State.activeSession()!.mirror;

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
    State.dispatch({ t: 'synced', id: State.mintConnId(), session: State.makeReadySession(device) });
    liveMirror().replaceCurrent(fromBulkParams(createHardwareProfile(PlatformType.RP2350), bulk));
    State.clearNotices();
    actions.setInputSource(State.activeSession()!, AudioInputSource.Spdif);
    // Notice rides the ack: nothing surfaces until the send settles.
    expect(State.notices.list.some((n) => n.kind === 'info' && /input source/i.test(n.message))).toBe(false);
    // Settle the write's microtasks without running the notice-expiry timer.
    await vi.advanceTimersByTimeAsync(0);
    expect(State.notices.list.some((n) => n.kind === 'info' && /input source/i.test(n.message))).toBe(true);
    expect(liveMirror().current?.inputConfig.source).toBe(AudioInputSource.Spdif);
    expect(setInputSourceFn).toHaveBeenCalledWith(AudioInputSource.Spdif);
  });

  it('drops the retained S/PDIF RX status frame on a source switch', async () => {
    const device = initializedDevice({
      setInputSource: vi.fn(async () => {}),
      getAllParams: vi.fn(async () => parseBulkParams(makeBulk())),
    });
    const bulk = parseBulkParams(makeBulk());
    State.dispatch({ t: 'synced', id: State.mintConnId(), session: State.makeReadySession(device) });
    liveMirror().replaceCurrent(fromBulkParams(createHardwareProfile(PlatformType.RP2350), bulk));
    State.activeSession()!.telemetry.spdifRxStatus = {
      state: 2, inputSource: 1, lockCount: 3, lossCount: 0,
      sampleRate: 48000, parityErrors: 0, fifoFillPct: 50,
    };
    actions.setInputSource(State.activeSession()!, AudioInputSource.Spdif);
    await vi.advanceTimersByTimeAsync(0);
    expect(State.activeSession()!.telemetry.spdifRxStatus).toBeNull();
  });
});

describe('output config verbs', () => {
  beforeEach(async () => {
    await bootMock('rp2350');
    State.clearNotices();
  });

  it('setOutputDataPin success patches draft.outputPins without discarding other edits', async () => {
    const before = liveMirror().current!.masterVolumeDb;
    actions.setOutputDataPin(State.activeSession()!, 0, 16);
    await flushAllWrites();
    expect(liveMirror().current!.outputPins[0]).toBe(16);
    expect(liveMirror().current!.masterVolumeDb).toBe(before);
  });

  it('setOutputDataPin failure leaves outputPins unchanged and toasts the device message', async () => {
    // pin 7 is in use by pinOutputIndex 1 — mock returns PinInUse
    const pinsBefore = liveMirror().current!.outputPins.slice();
    actions.setOutputDataPin(State.activeSession()!, 0, 7);
    await flushAllWrites();
    expect(liveMirror().current!.outputPins).toEqual(pinsBefore);
    expect(State.notices.list).toHaveLength(1);
    expect(State.notices.list[0].message).toContain('in use');
  });

  it('setOutputType updates draft.i2s.outputSlotTypes', async () => {
    actions.setOutputType(State.activeSession()!, 0, 1);
    await flushAllWrites();
    expect(liveMirror().current!.i2s.outputSlotTypes[0]).toBe(1);
  });

  test('setI2sBckPin success patches draft.i2s.bckPin', async () => {
    actions.setI2sBckPin(State.activeSession()!, 16);
    await flushAllWrites();
    expect(liveMirror().current!.i2s.bckPin).toBe(16);
  });

  test('setMckEnabled success patches draft.i2s.mckEnabled', async () => {
    actions.setMckEnabled(State.activeSession()!, true);
    await flushAllWrites();
    expect(liveMirror().current!.i2s.mckEnabled).toBe(true);
  });

  test('setI2sClockMode success patches draft.inputConfig.i2sClockMode', async () => {
    actions.setI2sClockMode(State.activeSession()!, 1);
    await flushAllWrites();
    expect(liveMirror().current!.inputConfig.i2sClockMode).toBe(1);
  });

  test('setI2sClockPinMode success patches draft.i2s.clockPinMode', async () => {
    actions.setI2sClockPinMode(State.activeSession()!, 1);
    await flushAllWrites();
    expect(liveMirror().current!.i2s.clockPinMode).toBe(1);
  });

  test('setI2sBckPinSlave success patches draft.i2s.bckPinSlave', async () => {
    actions.setI2sBckPinSlave(State.activeSession()!, 21);
    await flushAllWrites();
    expect(liveMirror().current!.i2s.bckPinSlave).toBe(21);
  });

  it('requests a non-eager reconcile on a successful config write', async () => {
    State.activeSession()!.mirror.consumeReconcile(); // clear anything pending from boot
    actions.setI2sBckPin(State.activeSession()!, 16);
    await flushAllWrites();
    expect(State.activeSession()!.mirror.peekReconcile()).toEqual({ wanted: true, eager: false });
  });

  it('factoryResetDevice toasts completion on success', async () => {
    await factoryResetDevice();
    expect(State.notices.list.some((n) => n.kind === 'info' && n.message.includes('Factory reset complete'))).toBe(true);
  });

  it('while the link is degraded, factory reset and preset operations send nothing', async () => {
    const s = State.activeSession()!;
    s.health.degraded = true;
    const reset = vi.spyOn(s.device, 'factoryReset');
    const rename = vi.spyOn(s.device, 'setPresetName');
    State.clearNotices();
    await factoryResetDevice();
    const r = await renamePresetSlot(s, 1 as PresetSlot, 'x');
    expect(r.ok).toBe(false);
    expect(reset).not.toHaveBeenCalled();
    expect(rename).not.toHaveBeenCalled();
    // A confirmed reset that goes nowhere says so; preset verbs report through their result.
    expect(State.notices.list.map((n) => n.kind)).toEqual(['warn']);
  });

  it('saveOutputConfigBaseline warns on failure and stays silent on success', async () => {
    State.clearNotices();
    const failDevice = initializedDevice({
      saveOutputConfig: async () => ({ ok: false as const, code: 4 as any, message: 'preset flash write error' }),
    });
    State.dispatch({ t: 'synced', id: State.mintConnId(), session: State.makeReadySession(failDevice) });
    actions.saveOutputConfigBaseline(State.activeSession()!);
    await flushAllWrites();
    expect(State.notices.list.some((n) => n.kind === 'warn' && /output config/i.test(n.message))).toBe(true);

    State.clearNotices();
    const okDevice = initializedDevice({
      saveOutputConfig: async () => ({ ok: true as const, value: undefined }),
    });
    State.dispatch({ t: 'synced', id: State.mintConnId(), session: State.makeReadySession(okDevice) });
    actions.saveOutputConfigBaseline(State.activeSession()!);
    await flushAllWrites();
    expect(State.notices.list).toHaveLength(0);
  });
});

describe('ADAT output verbs (fw V17+, RP2350)', () => {
  beforeEach(async () => {
    await bootMock('rp2350', { wireVersion: 17, fwVersion: { major: 1, minor: 1, patch: 5 } });
    State.clearNotices();
  });

  it('setAdatEnable success patches draft.adat.enabled', async () => {
    const ok = await actions.setAdatEnable(State.activeSession()!, true);
    expect(ok).toBe(true);
    expect(liveMirror().current!.adat.enabled).toBe(true);
  });

  it('setAdatEnable(false) clears any stale adatStatus telemetry', async () => {
    await actions.setAdatEnable(State.activeSession()!, true);
    State.activeSession()!.telemetry.adatStatus = { enabled: true, active: true, pin: 12, rateOk: true, resyncCount: 2, slipCount: 1 };
    const ok = await actions.setAdatEnable(State.activeSession()!, false);
    expect(ok).toBe(true);
    expect(liveMirror().current!.adat.enabled).toBe(false);
    expect(State.activeSession()!.telemetry.adatStatus).toBeNull();
  });

  it('setAdatPin success patches draft.adat.pin', async () => {
    const ok = await actions.setAdatPin(State.activeSession()!, 20);
    expect(ok).toBe(true);
    expect(liveMirror().current!.adat.pin).toBe(20);
  });

  it('setAdatPin with the 0xFF reset sentinel skips the mirror patch and requests an eager reconcile', async () => {
    State.activeSession()!.mirror.consumeReconcile(); // clear anything pending from boot
    const pinBefore = liveMirror().current!.adat.pin;
    const ok = await actions.setAdatPin(State.activeSession()!, Wire.Const.PIN_RESET_TO_DEFAULT);
    expect(ok).toBe(true);
    expect(liveMirror().current!.adat.pin).toBe(pinBefore);
    expect(State.activeSession()!.mirror.peekReconcile()).toEqual({ wanted: true, eager: true });
  });
});

describe('ADAT output verbs — device rejection (RP2040 has no ADAT hardware)', () => {
  it('both verbs leave the mirror untouched and toast the device message', async () => {
    await bootMock('rp2040', { wireVersion: 17, fwVersion: { major: 1, minor: 1, patch: 5 } });
    State.clearNotices();
    const pinBefore = liveMirror().current!.adat.pin;
    expect(await actions.setAdatEnable(State.activeSession()!, true)).toBe(false);
    expect(await actions.setAdatPin(State.activeSession()!, 20)).toBe(false);
    expect(liveMirror().current!.adat.enabled).toBe(false);
    expect(liveMirror().current!.adat.pin).toBe(pinBefore);
    expect(State.notices.list).toHaveLength(1);   // identical device messages collapse into one toast
  });
});

describe('ADAT input verbs (fw V24+, RP2350)', () => {
  beforeEach(async () => {
    await bootMock('rp2350', { wireVersion: 24, fwVersion: { major: 1, minor: 1, patch: 5 } });
    State.clearNotices();
  });

  it('setAdatInputEnable success patches draft.inputConfig.adatInputEnabled and clears stale telemetry on disable', async () => {
    await actions.setAdatInputPin(State.activeSession()!, 20);   // enable requires a stored pin
    const enabled = await actions.setAdatInputEnable(State.activeSession()!, true);
    expect(enabled).toBe(true);
    expect(liveMirror().current!.inputConfig.adatInputEnabled).toBe(true);

    State.activeSession()!.telemetry.adatInputStatus = {
      state: 3, clockMode: 0, enabled: true, pin: 20, rateOk: true,
      lockCount: 1, lossCount: 0, slipCount: 0, headerErr: 0, detectedRateHz: 48000, measuredHz: 48000,
    };
    const disabled = await actions.setAdatInputEnable(State.activeSession()!, false);
    expect(disabled).toBe(true);
    expect(liveMirror().current!.inputConfig.adatInputEnabled).toBe(false);
    expect(State.activeSession()!.telemetry.adatInputStatus).toBeNull();
  });

  it('setAdatInputPin patches draft.inputConfig.adatInputPin, including the 0xFF reset clearing it to 0', async () => {
    const ok = await actions.setAdatInputPin(State.activeSession()!, 20);
    expect(ok).toBe(true);
    expect(liveMirror().current!.inputConfig.adatInputPin).toBe(20);

    const cleared = await actions.setAdatInputPin(State.activeSession()!, Wire.Const.PIN_RESET_TO_DEFAULT);
    expect(cleared).toBe(true);
    expect(liveMirror().current!.inputConfig.adatInputPin).toBe(0);
  });

  it('setAdatInputClockMode patches draft.inputConfig.adatInputClockMode', async () => {
    const ok = await actions.setAdatInputClockMode(State.activeSession()!, 1);
    expect(ok).toBe(true);
    expect(liveMirror().current!.inputConfig.adatInputClockMode).toBe(1);
  });
});

describe('ADAT input verbs — device rejection (RP2040 has no ADAT hardware)', () => {
  it('both verbs leave the mirror untouched and toast the device message', async () => {
    await bootMock('rp2040', { wireVersion: 24, fwVersion: { major: 1, minor: 1, patch: 5 } });
    State.clearNotices();
    const pinBefore = liveMirror().current!.inputConfig.adatInputPin;
    expect(await actions.setAdatInputEnable(State.activeSession()!, true)).toBe(false);
    expect(await actions.setAdatInputPin(State.activeSession()!, 20)).toBe(false);
    expect(liveMirror().current!.inputConfig.adatInputEnabled).toBe(false);
    expect(liveMirror().current!.inputConfig.adatInputPin).toBe(pinBefore);
    expect(State.notices.list).toHaveLength(1);   // identical device messages collapse into one toast
  });
});
