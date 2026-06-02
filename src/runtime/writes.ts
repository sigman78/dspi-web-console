// Write lanes for the device-first model: a runtime action routes its wire
// send through one of these, which coordinates the mirror mutation, the
// reconcile signal, and failure recovery.
//
// write()        — click-paced. Await ack, then mutate. Failure -> forceResyncNow.
// scrub()        — drag-paced sliders. Optimistic mutate + 16 ms coalesce lane.
// writeChecked() — commit-paced commands returning a typed Result. A non-ok is
//                  a local device rejection (warn toast), not a connection
//                  error — no resync, no status flip.
//
// All respect the session.generation stale guard: a send that settles after a
// disconnect+reconnect is silently dropped (no mutate, no recovery).

import { session, settings, pushNotice, dispatch } from '@/state';
import { bumpInflight, dropInflight, requestReconcile, noteWriteActivity } from '@/state/mirror.svelte';
import { forceResyncNow } from './resync';
import { Log, type Result } from '@/utils';

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// Click-paced write. Awaits the wire ack, mutates the mirror on success.
// On throw: flips status to 'error' and forces a resync to recover ground
// truth. The mutate is *never* applied on failure — the mirror never holds
// an optimistic value that didn't survive.
export async function write(
  send: () => Promise<unknown>,
  mutate: () => void,
): Promise<void> {
  const gen = session.generation;
  noteWriteActivity();
  bumpInflight();
  const settled = (async () => {
    try {
      await send();
      if (gen === session.generation) {
        mutate();
        requestReconcile(settings.eagerReconcile);
      }
    } catch (err) {
      if (gen !== session.generation) return;
      Log.error('writes', 'write send failed; forcing resync', err);
      dispatch({ t: 'failed', message: errMessage(err) });
      void forceResyncNow();
    } finally {
      dropInflight();
    }
  })();
  _coord.inflightWrites.add(settled);
  void settled.finally(() => _coord.inflightWrites.delete(settled));
  return settled;
}

// Fire-and-forget a device command under the generation stale-guard and the
// inflight registry (so flushAllWrites drains it). `onSettled` runs with the
// resolved value ONLY if the generation is still current — a settle after a
// disconnect+reconnect is silently dropped (no mutation, no toast). A throw is
// logged and surfaced as an error toast; it never flips connection status (one
// command failing is local). Substrate for writeChecked() and the standalone
// device commands (setMasterVolumeMode, saveMasterVolumeBaseline).
export function command<T>(
  op: string,
  send: () => Promise<T>,
  onSettled: (result: T) => void,
): Promise<void> {
  const gen = session.generation;
  noteWriteActivity();
  bumpInflight();
  const settled = (async () => {
    try {
      const r = await send();
      if (gen === session.generation) onSettled(r);
    } catch (err) {
      if (gen !== session.generation) return;
      Log.error('writes', `${op} failed`, err);
      pushNotice('error', `${op} failed`);
    } finally {
      dropInflight();
    }
  })();
  _coord.inflightWrites.add(settled);
  void settled.finally(() => _coord.inflightWrites.delete(settled));
  return settled;
}

// Commit-paced command returning a typed device Result. A non-ok is the device
// *declining* a valid-looking command (pin in use, output active) — surfaced as
// a warn toast carrying the device's own message, mirror untouched, no resync
// or status flip. On ok, patch the mirror and request a reconcile (honoring
// settings.eagerReconcile, exactly like write()/scrub()).
export function writeChecked<E>(
  op: string,
  send: () => Promise<Result<void, E>>,
  patch: () => void,
): Promise<void> {
  return command(op, send, (r) => {
    if (!r.ok) { pushNotice('warn', r.message); return; }
    patch();
    requestReconcile(settings.eagerReconcile);
  });
}

// Per-key 16 ms latest-wins coalesce lane. Each scrub() call replaces the
// pending send for its key; the timer fires once per drag-quiet window.
// Generation-guarded: a send that completes after a disconnect+reconnect
// is silently dropped — no mirror update, no recovery resync.

const COALESCE_MS = 16;

interface Lane {
  schedule(send: () => Promise<void>): void;
  cancel(): void;
  flushNow(): Promise<void>;
}

function makeLane(key: string, ms: number): Lane {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: (() => Promise<void>) | null = null;
  let inFlight: Promise<void> = Promise.resolve();
  let claimedInflight = false;

  function fire(): void {
    timer = null;
    const thunk = pending!;
    const gen = session.generation;
    pending = null;
    inFlight = inFlight
      .catch(() => undefined)
      .then(async () => {
        try {
          await thunk();
          // Success: the optimistic mutate already left the mirror at the value
          // we sent (case A — Q3). No per-settle resync; instead flag a
          // reconcile for the inflight-gated background param poll to honor.
          if (gen === session.generation) requestReconcile(settings.eagerReconcile);
        } catch (err) {
          if (gen !== session.generation) return;
          Log.error('writes', `scrub ${key} send failed; forcing resync`, err);
          dispatch({ t: 'failed', message: errMessage(err) });
          void forceResyncNow();
        } finally {
          if (claimedInflight) {
            dropInflight();
            claimedInflight = false;
          }
        }
      });
  }

  return {
    schedule(send) {
      pending = send;
      if (!claimedInflight) {
        bumpInflight();
        claimedInflight = true;
      }
      if (timer === null) timer = setTimeout(fire, ms);
    },
    cancel() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      pending = null;
      if (claimedInflight) {
        dropInflight();
        claimedInflight = false;
      }
    },
    flushNow() {
      if (timer !== null) { clearTimeout(timer); fire(); }
      return inFlight;
    },
  };
}

export class WriteCoordinator {
  readonly inflightWrites = new Set<Promise<void>>();
  readonly lanes = new Map<string, Lane>();

  laneFor(key: string): Lane {
    let lane = this.lanes.get(key);
    if (!lane) { lane = makeLane(key, COALESCE_MS); this.lanes.set(key, lane); }
    return lane;
  }
  async flush(): Promise<void> {
    await Promise.all([
      ...[...this.lanes.values()].map((l) => l.flushNow()),
      ...this.inflightWrites,
    ]);
  }
  cancel(): void {
    for (const lane of this.lanes.values()) lane.cancel();
    this.lanes.clear();
    this.inflightWrites.clear();
  }
}

// Module singleton — exports delegate here for now; Task 2 routes them to the
// active session's coordinator.
const _coord = new WriteCoordinator();

// Drag-paced write. Mutates the mirror immediately (optimistic — needed for
// drag feel at 60 fps), schedules a coalesced wire send per key, and arms
// a trailing resync on settle.
export function scrub(
  key: string,
  mutate: () => void,
  send: () => Promise<void>,
): void {
  noteWriteActivity();
  mutate();
  _coord.laneFor(key).schedule(send);
}

// Drain every armed lane and wait for its in-flight send to settle. Used
// by preset transitions before issuing a flash command. Also awaits any
// in-flight write() operations (fire-and-forget click-paced writes).
export async function flushAllWrites(): Promise<void> {
  await _coord.flush();
}

// Cancel every armed lane without firing. Used by the disconnect path.
// Also clears the inflightWrites registry: the generation guard already
// prevents stale settles from mutating or triggering recovery; clearing
// the registry ensures flushAllWrites on the next connection doesn't
// await ghosts from a prior session.
export function cancelAllWrites(): void {
  _coord.cancel();
}
