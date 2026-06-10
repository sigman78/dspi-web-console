import type { NotifyEvent } from '@/protocol';

interface Waiter {
  predicate: (e: NotifyEvent) => boolean;
  settle: (e: NotifyEvent | null) => void;
}

// Per-session registry letting an action await a specific device notification
// (e.g. presetLoaded for a slot). The notify channel calls notify() for every
// event BEFORE its own routing; waiters observe, never consume. Register the
// waiter BEFORE sending the command that provokes the event -- the firmware is
// single-threaded, so the event cannot reach the wire before the command does.
export class NotifyWaiters {
  #waiters = new Set<Waiter>();
  #kick: (() => void) | null = null;

  // The notify channel installs a kick that bursts its read cadence while a
  // waiter is pending; without it the default cadence adds ~2 read cycles of latency.
  setKick(fn: (() => void) | null): void { this.#kick = fn; }
  pending(): boolean { return this.#waiters.size > 0; }

  notify(e: NotifyEvent): void {
    for (const w of [...this.#waiters]) {
      if (w.predicate(e)) {
        this.#waiters.delete(w);
        w.settle(e);
      }
    }
  }

  // Resolves with the matching event, or null on timeout (caller falls back).
  waitFor(predicate: (e: NotifyEvent) => boolean, timeoutMs: number): Promise<NotifyEvent | null> {
    return new Promise((resolve) => {
      const w: Waiter = { predicate, settle: resolve };
      const timer = setTimeout(() => { this.#waiters.delete(w); resolve(null); }, timeoutMs);
      w.settle = (e) => { clearTimeout(timer); resolve(e); };
      this.#waiters.add(w);
      this.#kick?.();
    });
  }

  cancelAll(): void {
    for (const w of [...this.#waiters]) {
      this.#waiters.delete(w);
      w.settle(null);
    }
  }
}
