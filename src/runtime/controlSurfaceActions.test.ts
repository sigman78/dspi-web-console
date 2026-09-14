import { describe, it, expect, vi, afterEach } from 'vitest';
import * as actions from './controlSurfaceActions';
import { notices, clearNotices, dispatch, mintConnId, makeReadySession, activeSession, resetAppState } from '@/state';
import type { DspDevice } from '@/device/DspDevice';
import { PinConfigResult } from '@/protocol';
import { Result } from '@/utils';
import { PlatformType, createHardwareProfile, type UartControlConfig, type ControlIfaceStatus } from '@/domain';
import { deriveCapabilities } from '@/protocol/capabilities';
import { flushAllWrites as flushAllWritesFor } from './writes.svelte';

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

afterEach(() => { activeSession()?.dispose(); cancelWrites(); resetAppState(); });

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
