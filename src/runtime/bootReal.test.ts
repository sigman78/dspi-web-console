import { describe, test, expect, vi, beforeEach } from 'vitest';

// Shared mock handles (hoisted so the vi.mock factories below can reference them).
const { tryAutoConnect } = vi.hoisted(() => ({ tryAutoConnect: vi.fn() }));
const { isDeviceHeld } = vi.hoisted(() => ({ isDeviceHeld: vi.fn() }));

vi.mock('@/transport/WebUsbTransport', () => ({
  matchesDspi: () => true,
  WebUsbTransport: class {
    tryAutoConnect = tryAutoConnect;
    requestAndOpen = vi.fn();
    on = vi.fn(() => () => {});
    close = vi.fn();
  },
}));

vi.mock('./deviceLock', () => ({
  isDeviceHeld,
  acquireDeviceLock: vi.fn(),
  releaseDeviceLock: vi.fn(),
}));

import { bootReal } from './session';
import { setStatus } from '@/state';

beforeEach(() => {
  vi.clearAllMocks();
  setStatus('idle');
});

describe('bootReal — auto-connect gating', () => {
  test('skips the claim attempt when another tab holds the device', async () => {
    isDeviceHeld.mockResolvedValue(true);
    await bootReal();
    expect(tryAutoConnect).not.toHaveBeenCalled();
  });

  test('attempts auto-connect when the device is free', async () => {
    isDeviceHeld.mockResolvedValue(false);
    tryAutoConnect.mockResolvedValue(false); // no paired device → bootReal returns cleanly
    await bootReal();
    expect(tryAutoConnect).toHaveBeenCalledTimes(1);
  });
});
