export const ACK_HOLD_MS = 1500;

/**
 * Keeps an optimistic value on screen after a write until the device
 * acknowledges it. `value` goes null once `isAcked` reports true or the
 * timeout lapses, whichever comes first.
 */
export function createAckHold<T>(timeoutMs = ACK_HOLD_MS) {
  let held = $state.raw<T | null>(null);
  let acked: (() => boolean) | null = null;
  let latched = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function release(): void {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    acked = null;
    latched = false;
    held = null;
  }

  return {
    get value(): T | null {
      const v = held;
      if (v === null || latched) return null;
      if (acked?.()) {
        latched = true;
        return null;
      }
      return v;
    },
    begin(optimistic: T, isAcked: () => boolean): void {
      release();
      acked = isAcked;
      held = optimistic;
      timer = setTimeout(release, timeoutMs);
    },
    release,
  };
}
