import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DspDevice } from '../device/DspDevice';
import { openSingleDevice } from '../../hil/setup';
import { fullSync } from './actions';
import { session, bindDevice } from '../state/session.svelte';
import { settings } from '../state/settings.svelte';
import { dsp, resetDsp } from '../state/dsp.svelte';
import { stopPolling } from './poll';
import { resetStatus } from '../state/telemetry.svelte';

// End-to-end HIL test: drives the production state-layer fullSync flow
// against real silicon. The most valuable thing this catches is the slice-3
// wiring (single device pointer, argumentless getSystemStatus, the new
// getDeviceInfo collapsing two transfers) actually working when the bytes
// come from a real cable rather than the mock.
//
// We deliberately do NOT call attachTransportListeners. The 'connect' /
// 'disconnect' transport events would fire after this test (during
// teardown) and re-trigger fullSync against a closing transport.

describe('state.fullSync — end-to-end against real hardware (HIL)', () => {
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
    await fullSync();

    expect(session.status).toBe('connected');
    expect(session.identity.serial.length).toBeGreaterThan(0);
    expect(session.identity.firmwareVersion.length).toBeGreaterThan(0);
    expect(settings.lastSerial).toBe(session.identity.serial);

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

  it('is idempotent: a second fullSync settles to the same state', async () => {
    const before = {
      serial: session.identity.serial,
      fw: session.identity.firmwareVersion,
      platform: dsp.live?.platform.name,
      formatVersion: dsp.live?.formatVersion,
    };
    await fullSync();
    expect(session.status).toBe('connected');
    expect(session.identity.serial).toBe(before.serial);
    expect(session.identity.firmwareVersion).toBe(before.fw);
    expect(dsp.live?.platform.name).toBe(before.platform);
    expect(dsp.live?.formatVersion).toBe(before.formatVersion);
  });
});
