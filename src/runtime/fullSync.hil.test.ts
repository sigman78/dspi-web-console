import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DspDevice } from '@/device/DspDevice';
import { openSingleDevice } from '@test/hil/setup';
import { finishConnection } from './actions';
import { session, bindDevice, settings, dsp, resetDsp, resetStatus } from '@/state';
import { stopPolling } from './poll';

// End-to-end HIL test: drives the production state-layer connection finish flow
// against real silicon. The most valuable thing this catches is the slice-3
// wiring (single device pointer, argumentless getSystemStatus, the new
// factory-captured identity/hardware) actually working when the bytes
// come from a real cable rather than the mock.
//
// We deliberately do NOT call attachTransportListeners. The 'connect' /
// 'disconnect' transport events would fire after this test (during
// teardown) and re-trigger connection finish against a closing transport.

describe('state.finishConnection — end-to-end against real hardware (HIL)', () => {
  let device: DspDevice;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const opened = await openSingleDevice();
    device = opened.device;
    close = opened.close;
    bindDevice(device);
  });

  afterAll(async () => {
    stopPolling();
    bindDevice(null);
    resetDsp();
    resetStatus();
    if (close) await close();
  });

  it('hydrates connection + dsp.live from real device', async () => {
    await finishConnection(device);

    expect(session.status).toBe('connected');
    expect(session.lastDeviceInfo?.serial.length ?? 0).toBeGreaterThan(0);
    expect(session.lastDeviceInfo?.firmwareVersion.length ?? 0).toBeGreaterThan(0);
    expect(settings.lastSerial).toBe(session.lastDeviceInfo?.serial);

    const snap = dsp.live;
    expect(snap).not.toBeNull();
    if (!snap) return;

    expect(['RP2040', 'RP2350']).toContain(snap.platform.name);
    expect(snap.platform.totalChannelCount).toBeGreaterThan(0);
    expect(snap.channels.length).toBe(snap.platform.totalChannelCount);
    expect(snap.outputs.length).toBe(snap.platform.outputCount);
    expect(snap.routes.length).toBe(2 * snap.platform.outputCount);
    expect(snap.formatVersion).toBeGreaterThanOrEqual(2);
  });

  it('is idempotent: a second finishConnection settles to the same state', async () => {
    const before = {
      serial: session.lastDeviceInfo?.serial,
      fw: session.lastDeviceInfo?.firmwareVersion,
      platform: dsp.live?.platform.name,
      formatVersion: dsp.live?.formatVersion,
    };
    await finishConnection(device);
    expect(session.status).toBe('connected');
    expect(session.lastDeviceInfo?.serial).toBe(before.serial);
    expect(session.lastDeviceInfo?.firmwareVersion).toBe(before.fw);
    expect(dsp.live?.platform.name).toBe(before.platform);
    expect(dsp.live?.formatVersion).toBe(before.formatVersion);
  });
});
