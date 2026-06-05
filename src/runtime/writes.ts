// Write lanes for the device-first model: a runtime action routes its wire
// send through one of these, which coordinates the mirror mutation, the
// reconcile signal, and failure recovery. Each lane operates on the session
// it is GIVEN (passed in by the action) — never the ambient active session —
// so inflight, alive, and reconcile bookkeeping always lands on the same
// session the send/mutate closures target, even across a reconnect or switch.
//
// write()        — click-paced. Await ack, then mutate. Failure -> forceResyncNow.
// scrub()        — drag-paced sliders. Optimistic mutate + 16 ms coalesce lane.
// writeChecked() — commit-paced commands returning a typed Result. A non-ok is
//                  a local device rejection (warn toast), not a connection
//                  error — no resync, no status flip.
//
// All respect the per-session `alive` guard: a send that settles after its
// session was disposed (disconnect) is silently dropped (no mutate, no recovery).

import { settings, pushNotice, dispatch, type ReadySession } from '@/state';
import type { MirrorState } from '@/state/mirror.svelte';
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
  s: ReadySession,
  send: () => Promise<unknown>,
  mutate: () => void,
): Promise<void> {
  s.mirror.noteWriteActivity();
  s.mirror.bumpInflight();
  const settled = (async () => {
    try {
      await send();
      if (s.alive) {
        mutate();
        s.mirror.requestReconcile(settings.eagerReconcile);
      }
    } catch (err) {
      if (!s.alive) return;
      Log.error('writes', 'write send failed; forcing resync', err);
      dispatch({ t: 'failed', message: errMessage(err) });
      void forceResyncNow();
    } finally {
      s.mirror.dropInflight();
    }
  })();
  s.writes.inflightWrites.add(settled);
  void settled.finally(() => s.writes.inflightWrites.delete(settled));
  return settled;
}

// Fire-and-forget a device command under the per-session alive guard and the
// inflight registry (so flushAllWrites drains it). `onSettled` runs with the
// resolved value ONLY if the passed session is still alive — a settle after the
// session was disposed (disconnect) is silently dropped (no mutation, no toast). A throw is
// logged and surfaced as an error toast; it never flips connection status (one
// command failing is local). Substrate for writeChecked() and the standalone
// device commands (setMasterVolumeMode, saveMasterVolumeBaseline).
export function command<T>(
  s: ReadySession,
  op: string,
  send: () => Promise<T>,
  onSettled: (result: T, s: ReadySession) => void,
): Promise<void> {
  s.mirror.noteWriteActivity();
  s.mirror.bumpInflight();
  const settled = (async () => {
    try {
      const r = await send();
      if (s.alive) onSettled(r, s);
    } catch (err) {
      if (!s.alive) return;
      Log.error('writes', `${op} failed`, err);
      pushNotice('error', `${op} failed`);
    } finally {
      s.mirror.dropInflight();
    }
  })();
  s.writes.inflightWrites.add(settled);
  void settled.finally(() => s.writes.inflightWrites.delete(settled));
  return settled;
}

// Commit-paced command returning a typed device Result. A non-ok is the device
// *declining* a valid-looking command (pin in use, output active) — surfaced as
// a warn toast carrying the device's own message, mirror untouched, no resync
// or status flip. On ok, patch the mirror and request a reconcile (honoring
// settings.eagerReconcile, exactly like write()/scrub()).
export function writeChecked<E>(
  s: ReadySession,
  op: string,
  send: () => Promise<Result<void, E>>,
  patch: () => void,
): Promise<void> {
  return command(s, op, send, (r, s) => {
    if (!r.ok) { pushNotice('warn', r.message); return; }
    patch();
    s.mirror.requestReconcile(settings.eagerReconcile);
  });
}

// Per-key 16 ms latest-wins coalesce lane. Each scrub() call replaces the
// pending send for its key; the timer fires once per drag-quiet window.
// Alive-guarded against the session captured at schedule time: a send that
// completes after that session was disposed (disconnect) is silently dropped —
// no mirror update, no recovery resync.

const COALESCE_MS = 16;

interface Lane {
  schedule(s: ReadySession, send: () => Promise<void>): void;
  cancel(): void;
  flushNow(): Promise<void>;
}

function makeLane(key: string, ms: number, mirror: MirrorState): Lane {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: (() => Promise<void>) | null = null;
  let pendingSession: ReadySession | null = null;
  let inFlight: Promise<void> = Promise.resolve();
  let claimedInflight = false;

  function fire(): void {
    timer = null;
    const thunk = pending!;
    const s = pendingSession!;
    pending = null;
    pendingSession = null;
    inFlight = inFlight
      .catch(() => undefined)
      .then(async () => {
        try {
          await thunk();
          // Success: the optimistic mutate already left the mirror at the value
          // we sent (case A — Q3). No per-settle resync; instead flag a
          // reconcile for the inflight-gated background param poll to honor.
          if (s.alive) mirror.requestReconcile(settings.eagerReconcile);
        } catch (err) {
          if (!s.alive) return;
          Log.error('writes', `scrub ${key} send failed; forcing resync`, err);
          dispatch({ t: 'failed', message: errMessage(err) });
          void forceResyncNow();
        } finally {
          if (claimedInflight) {
            mirror.dropInflight();
            claimedInflight = false;
          }
        }
      });
  }

  return {
    schedule(s, send) {
      pending = send;
      pendingSession = s;
      if (!claimedInflight) {
        mirror.bumpInflight();
        claimedInflight = true;
      }
      if (timer === null) timer = setTimeout(fire, ms);
    },
    cancel() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      pending = null;
      pendingSession = null;
      if (claimedInflight) {
        mirror.dropInflight();
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

  constructor(readonly mirror: MirrorState) {}

  laneFor(key: string): Lane {
    let lane = this.lanes.get(key);
    if (!lane) { lane = makeLane(key, COALESCE_MS, this.mirror); this.lanes.set(key, lane); }
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

// Drag-paced write. Mutates the mirror immediately (optimistic — needed for
// drag feel at 60 fps), schedules a coalesced wire send per key on the active
// session's coordinator, and gates the settle on that session's `alive` flag.
export function scrub(
  s: ReadySession,
  key: string,
  mutate: () => void,
  send: () => Promise<void>,
): void {
  s.mirror.noteWriteActivity();
  mutate();
  s.writes.laneFor(key).schedule(s, send);
}

// Drain the given session's armed lanes and await its in-flight write()
// operations. Used by preset transitions before issuing a flash command.
export async function flushAllWrites(s: ReadySession): Promise<void> {
  await s.writes.flush();
}

// Cancel the given session's armed lanes without firing and clear its in-flight
// registry. The session's own dispose() does this on disconnect; this export
// remains for any direct mid-session caller.
export function cancelAllWrites(s: ReadySession): void {
  s.writes.cancel();
}
