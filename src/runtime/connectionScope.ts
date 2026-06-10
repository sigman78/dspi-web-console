import { newAttempt, clearAttempt } from '@/state';
import { Log } from '@/utils';

type Disposer = () => void;

// Owns the teardown of resources started for one device connection (poll loop,
// resync timer, command lanes, transport listeners). The app holds one device
// at a time, so there is a single module-level active scope. Each scope carries
// the attempt token that scopes this connection's app events.
export class ConnectionScope {
  readonly attempt = newAttempt();
  #disposers: Disposer[] = [];
  add(d: Disposer): void { this.#disposers.push(d); }
  // LIFO, idempotent, error-isolating: one failing disposer must not strand the rest.
  dispose(): void {
    while (this.#disposers.length) {
      const d = this.#disposers.pop()!;
      try { d(); } catch (e) { Log.error('scope', 'disposer failed', e); }
    }
  }
}

let active: ConnectionScope | null = null;

// Open a fresh scope, disposing any prior one.
export function beginConnection(): ConnectionScope {
  active?.dispose();
  active = new ConnectionScope();
  return active;
}

export function connectionScope(): ConnectionScope | null { return active; }

// Dispose and clear the active scope. Idempotent.
export function endConnection(): void {
  active?.dispose();
  active = null;
  clearAttempt();
}
