// makeResyncScheduler: each-call-resets-the-timer, fires after a quiet
// window, no value, no serialisation. Right tool for
// "after the user stops fiddling, re-fetch once."

export interface ResyncScheduler {
  schedule(): void;
  cancel(): void;
}

// Trailing-edge debouncer for a side-effect (typically a bulk re-fetch).
// Each schedule() call resets the timer to fire `ms` ms in the future.
// cancel() clears any pending timer; call from disconnect paths.
//
// Failures inside `resync` are caught and ignored; the scheduler must
// keep working for future schedule() calls. The caller should log inside
// its own `resync` body if it cares.
export function makeResyncScheduler(
  resync: () => Promise<void>,
  ms: number,
): ResyncScheduler {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    schedule() {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        // Errors are caller's responsibility to log inside `resync`.
        void resync().catch(() => {});
      }, ms);
    },
    cancel() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}
