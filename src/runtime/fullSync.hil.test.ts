import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DspDevice } from '@/device/DspDevice';
import { openSingleDevice } from '@test/hil/setup';
import { wireUpConnection } from './actionsDevice';
import { session, connection, bindDevice, settings, mirror, resetStatus } from '@/state';
import { endConnection } from './connectionScope';

// End-to-end HIL test: drives the production state-layer connection finish flow
// against real silicon. The most valuable thing this catches is the slice-3
// wiring (single device pointer, argumentless getSystemStatus, the new
// factory-captured identity/hardware) actually working when the bytes
// come from a real cable rather than the mock.
//
// We deliberately do NOT call attachTransportListeners. The 'connect' /
// 'disconnect' transport events would fire after this test (during
// teardown) and re-trigger connection finish against a closing transport.

describe('state.wireUpConnection — end-to-end against real hardware (HIL)', () => {
  let device: DspDevice;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const opened = await openSingleDevice();
    device = opened.device;
    close = opened.close;
    bindDevice(device);
  });

  afterAll(async () => {
    endConnection();
    bindDevice(null);
    mirror.reset();
    resetStatus();
    if (close) await close();
  });

  it('hydrates connection + mirror.current from real device', async () => {
    await wireUpConnection(device);

    expect(connection.connected).toBe(true);
    expect(session.device?.info.serial.length ?? 0).toBeGreaterThan(0);
    expect(session.device?.info.capabilities.fwLabel.length ?? 0).toBeGreaterThan(0);
    expect(settings.lastSerial).toBe(session.device?.info.serial);

    const snap = mirror.current;
    expect(snap).not.toBeNull();
    if (!snap) return;

    expect(['RP2040', 'RP2350']).toContain(snap.platform.name);
    expect(snap.platform.totalChannelCount).toBeGreaterThan(0);
    expect(snap.channels.length).toBe(snap.platform.totalChannelCount);
    expect(snap.outputs.length).toBe(snap.platform.outputCount);
    expect(snap.routes.length).toBe(2 * snap.platform.outputCount);
    expect(device.capabilities.wire).toBeGreaterThanOrEqual(2);
  });

  it('is idempotent: a second wireUpConnection settles to the same state', async () => {
    const before = {
      serial: session.device?.info.serial,
      fw: session.device?.info.capabilities.fwLabel,
      platform: mirror.current?.platform.name,
      wire: session.device?.info.capabilities.wire,
    };
    await wireUpConnection(device);
    expect(connection.connected).toBe(true);
    expect(session.device?.info.serial).toBe(before.serial);
    expect(session.device?.info.capabilities.fwLabel).toBe(before.fw);
    expect(mirror.current?.platform.name).toBe(before.platform);
    expect(session.device?.info.capabilities.wire).toBe(before.wire);
  });
});
