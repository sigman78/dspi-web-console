// Per-session link-health policy: every lane and poll reports successes and
// thrown transfer failures here; this store alone decides when the link is
// degraded. Typed device declines (non-ok Results) never reach it -- they are
// the device working correctly. Pure counters + a reactive flag: no timers, no
// runtime imports (the probe loop lives in runtime and reads this store).

const K_CONSECUTIVE = 3;      // consecutive thrown transfers...
const M_IN_WINDOW   = 5;      // ...or this many failures...
const WINDOW_MS     = 30_000; // ...within this window.
// One wedged moment can fail several lanes near-simultaneously; require the
// failures to span real time before declaring the link degraded.
const MIN_SPAN_MS   = 1_500;

export class LinkHealth {
  degraded = $state(false);
  lastErrorOp = $state<string | null>(null);
  lastErrorMsg = $state<string | null>(null);
  failTotal = $state(0);
  #consecutive = 0;
  #window: number[] = [];

  // Ordinary success (any poll or write ack). Resets the consecutive streak;
  // clears degraded only once the failure window has drained -- otherwise the
  // 20 Hz status poll's successes would erase "degraded" on a flaky-but-alive
  // link the instant it was declared.
  noteOk(now: number = performance.now()): void {
    this.#consecutive = 0;
    this.#prune(now);
    if (this.degraded && this.#window.length === 0) this.degraded = false;
  }

  // Probe-verified recovery: clears immediately, window included.
  noteRecovered(): void {
    this.#consecutive = 0;
    this.#window.length = 0;
    this.degraded = false;
  }

  noteFail(op: string, err: unknown, now: number = performance.now()): void {
    if (!isHealthEvent(err)) return;
    this.#consecutive += 1;
    this.failTotal += 1;
    this.#window.push(now);
    this.#prune(now);
    this.lastErrorOp = op;
    this.lastErrorMsg = err instanceof Error ? err.message : String(err);
    const span = this.#window.length > 1 ? now - this.#window[0] : 0;
    if ((this.#consecutive >= K_CONSECUTIVE || this.#window.length >= M_IN_WINDOW) && span >= MIN_SPAN_MS) {
      this.degraded = true;
    }
  }

  #prune(now: number): void {
    while (this.#window.length > 0 && now - this.#window[0] > WINDOW_MS) this.#window.shift();
  }
}

// Thrown before any transfer is attempted; a capability gap, not link trouble.
export function isHealthEvent(err: unknown): boolean {
  return !(err instanceof Error && err.name === 'UnsupportedOnFirmware');
}
