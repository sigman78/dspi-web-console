// Cross-tab device-ownership signalling via the Web Locks API. The connected
// tab holds an exclusive lock for its session; other tabs query it to detect
// that the device is already in use. Web Locks ships in every Chromium browser
// (so it is present exactly when WebUSB is), and the browser auto-releases the
// lock if the holding tab closes or crashes — no heartbeats needed.
const LOCK_NAME = 'dspi-device-active';

let release: (() => void) | null = null;

export function acquireDeviceLock(): void {
  if (release) return;
  const locks = navigator.locks;
  if (!locks) return;
  void locks.request(LOCK_NAME, () => new Promise<void>((resolve) => { release = resolve; }));
}

export function releaseDeviceLock(): void {
  release?.();
  release = null;
}

// True when some tab in this origin holds the device lock. The caller must gate
// on connection status: only meaningful when THIS tab is not the holder.
export async function isDeviceHeld(): Promise<boolean> {
  const locks = navigator.locks;
  if (!locks?.query) return false;
  try {
    const { held } = await locks.query();
    return (held ?? []).some((l) => l.name === LOCK_NAME);
  } catch {
    return false;
  }
}
