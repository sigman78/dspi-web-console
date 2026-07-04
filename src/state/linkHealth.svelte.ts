// Per-session link-health policy: every lane and poll reports successes and
// thrown transfer failures here; this store alone decides when the link is
// degraded. Typed device declines (non-ok Results) never reach it -- they are
// the device working correctly. Pure counters + a reactive flag: no timers, no
// runtime imports (the probe loop lives in runtime and reads this store).

const K_CONSECUTIVE = 3;      // consecutive thrown transfers -> degraded

export class LinkHealth {
  degraded = $state(false);
  lastErrorOp = $state<string | null>(null);
  lastErrorMsg = $state<string | null>(null);
  failTotal = $state(0);
  #consecutive = 0;

  // Ordinary success (any poll or write ack). Resets the consecutive streak
  // but does NOT clear degraded: with the serial command queue, failures
  // arrive one at a time, and a link that intermittently succeeds mid-outage
  // must not flap out of degraded and re-enable per-failure toasts/reconciles.
  // The probe (noteRecovered) is the single authority for recovery.
  noteOk(): void {
    this.#consecutive = 0;
  }

  // Probe-verified recovery: clears immediately.
  noteRecovered(): void {
    this.#consecutive = 0;
    this.degraded = false;
  }

  noteFail(op: string, err: unknown): void {
    this.#consecutive += 1;
    this.failTotal += 1;
    this.lastErrorOp = op;
    this.lastErrorMsg = err instanceof Error ? err.message : String(err);
    if (this.#consecutive >= K_CONSECUTIVE) this.degraded = true;
  }
}

