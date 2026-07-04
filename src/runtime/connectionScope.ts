// One connection's lifecycle, wrapping a single AbortController. Aborting it
// is the single teardown signal for everything that connection started:
// transport listeners, the device lock, poll/notify/probe loops, and the
// session itself. The class is a veneer, not a registry: teardown hooks ride
// the signal itself via onTeardown, so there is no separate disposer list to
// keep in sync.
export class ConnectionScope {
  #controller = new AbortController();

  // The observer half -- safe to hand out; cannot abort through it.
  get signal(): AbortSignal { return this.#controller.signal; }
  get aborted(): boolean { return this.#controller.signal.aborted; }

  // Register a teardown hook. Runs exactly once: on abort, or IMMEDIATELY if
  // the scope is already dead -- a listener added to an aborted signal never
  // fires, which would strand the resource with no teardown path.
  onTeardown(fn: () => void): void {
    if (this.aborted) { fn(); return; }
    this.#controller.signal.addEventListener('abort', () => fn(), { once: true });
  }

  abort(): void { this.#controller.abort(); }
}

let active: ConnectionScope | null = null;

// Abort any prior connection and open a fresh lifecycle scope.
export function beginConnection(): ConnectionScope {
  active?.abort();
  active = new ConnectionScope();
  return active;
}

// Test-only accessor; production reaches the scope via beginConnection()'s
// return value.
export function connectionScope(): ConnectionScope | null { return active; }

// Abort and clear the active connection. Idempotent.
export function endConnection(): void {
  active?.abort();
  active = null;
}
