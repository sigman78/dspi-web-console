// One AbortController per connection. Aborting it is the single teardown
// signal for everything that connection started: transport listeners, the
// device lock, poll/notify/probe loops, and the session itself (makeSession
// registers its own abort listener). Resources register their own cleanup
// via `signal.addEventListener('abort', ...)` at the point they're created,
// so there is no separate disposer registry to keep in sync.
let active: AbortController | null = null;

// Abort any prior connection and open a fresh lifecycle scope.
export function beginConnection(): AbortController {
  active?.abort();
  active = new AbortController();
  return active;
}

// Test-only accessor; production reaches the signal via beginConnection()'s
// returned controller.
export function connectionSignal(): AbortSignal | null { return active?.signal ?? null; }

// Abort and clear the active connection. Idempotent.
export function endConnection(): void {
  active?.abort();
  active = null;
}
