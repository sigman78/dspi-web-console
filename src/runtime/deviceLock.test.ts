import { describe, test, expect, vi, afterEach } from 'vitest';
import { isDeviceHeld, acquireDeviceLock } from './deviceLock';

const LOCK_NAME = 'dspi-device-active';

function stubLocks(locks: unknown): void {
  Object.defineProperty(navigator, 'locks', { value: locks, configurable: true });
}

afterEach(() => {
  // Remove the stub so the next test starts from a clean (locks-absent) state.
  Reflect.deleteProperty(navigator, 'locks');
  vi.restoreAllMocks();
});

describe('deviceLock', () => {
  test('isDeviceHeld → false when navigator.locks is absent', async () => {
    expect(await isDeviceHeld()).toBe(false);
  });

  test('isDeviceHeld → true when query reports the device lock held', async () => {
    stubLocks({ query: async () => ({ held: [{ name: LOCK_NAME }], pending: [] }) });
    expect(await isDeviceHeld()).toBe(true);
  });

  test('isDeviceHeld → false when held list lacks the device lock', async () => {
    stubLocks({ query: async () => ({ held: [{ name: 'other-lock' }], pending: [] }) });
    expect(await isDeviceHeld()).toBe(false);
  });

  test('isDeviceHeld → false when query throws', async () => {
    stubLocks({ query: async () => { throw new Error('denied'); } });
    expect(await isDeviceHeld()).toBe(false);
  });

  test('acquireDeviceLock → no-op when navigator.locks is absent', () => {
    expect(() => acquireDeviceLock()).not.toThrow();
  });

  test('acquireDeviceLock → requests the named lock when available', () => {
    const request = vi.fn();
    stubLocks({ request, query: async () => ({ held: [], pending: [] }) });
    acquireDeviceLock();
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0]).toBe(LOCK_NAME);
  });
});
