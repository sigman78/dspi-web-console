// Write lanes for the device-first model: a runtime action routes its wire send
// through one of these, which coordinates the mirror mutation, the reconcile
// signal, and failure recovery. Each lane operates on the session it is GIVEN
// (never the ambient active session), so inflight/alive/reconcile bookkeeping
// always lands on the session the send/mutate closures target, even across a
// reconnect or switch.
//
// write()        -- click-paced. Await ack, then mutate. Failure -> toast +
//                   forceResyncNow; link health decides anything bigger.
// scrub()        -- drag-paced sliders. Optimistic mutate + latest-wins lane.
// writeChecked() -- commit-paced commands returning a typed Result. A non-ok is a
//                   local device rejection (warn toast), not a connection error.
//
// All respect the per-session `alive` guard: a send that settles after its
// session was disposed (disconnect) is silently dropped (no mutate, no recovery).

import { pushNotice, type ReadySession } from '@/state';
import type { MirrorState } from '@/state/mirror.svelte';
import { forceResyncNow } from './resync';
import { Log, errMessage, type Result } from '@/utils';

// Click-paced write. Awaits the wire ack, mutates the mirror on success. On
// throw: reports link health, toasts, and forces a resync to recover ground
// truth. The mutate is never applied on failure, so the mirror never holds an
// optimistic value that didn't survive.
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
        s.mirror.requestReconcile(false);
      }
    } catch (err) {
      if (!s.alive) return;
      Log.error('writes', 'write send failed', err);
      s.health.noteFail('write', err);
      // Degraded: the probe owns recovery; per-failure toasts and 2s-timeout
      // resync fetches would only pile up behind a dead link.
      if (!s.health.degraded) {
        pushNotice('error', `Write failed: ${errMessage(err)}`);
        void forceResyncNow(s);
      }
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
// resolved value only if the passed session is still alive. A throw is logged and
// surfaced as an error toast; it never flips connection status (one command
// failing is local). Substrate for writeChecked() and the standalone device
// commands (setMasterVolumeMode, saveMasterVolumeBaseline).
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
      s.health.noteFail(op, err);
      if (!s.health.degraded) pushNotice('error', `${op} failed`);
    } finally {
      s.mirror.dropInflight();
    }
  })();
  s.writes.inflightWrites.add(settled);
  void settled.finally(() => s.writes.inflightWrites.delete(settled));
  return settled;
}

// Commit-paced command returning a typed device Result. A non-ok is the device
// declining a valid-looking command (pin in use, output active) -- surfaced as a
// warn toast carrying the device's own message, mirror untouched, no resync or
// status flip. On ok, patch the mirror and request a reconcile.
export function writeChecked<E>(
  s: ReadySession,
  op: string,
  send: () => Promise<Result<void, E>>,
  patch: () => void,
): Promise<void> {
  return command(s, op, send, (r, s) => {
    if (!r.ok) { pushNotice('warn', r.message); return; }
    patch();
    s.mirror.requestReconcile(false);
  });
}

// Per-key latest-wins lane: sends immediately when the wire is free; while a
// send is in flight, newer schedule() calls replace the parked one (queue
// depth 1), so pacing self-adapts to ack latency and a slow ack can never
// build a backlog of stale intermediate values. Alive-guarded against the
// session captured at schedule time: a send that completes after that session
// was disposed is silently dropped (no mirror update, no recovery resync).

interface Lane {
  schedule(s: ReadySession, send: () => Promise<void>): void;
  cancel(): void;
  flushNow(): Promise<void>;
}

function makeLane(key: string, mirror: MirrorState): Lane {
  let pending: (() => Promise<void>) | null = null;
  let pendingSession: ReadySession | null = null;
  let sending = false;
  let claimed = false;
  let chain: Promise<void> = Promise.resolve();

  function pump(): void {
    if (sending || pending === null) return;
    const thunk = pending;
    const s = pendingSession!;
    pending = null;
    pendingSession = null;
    sending = true;
    chain = (async () => {
      try {
        await thunk();
        // The optimistic mutate already left the mirror at the value we sent.
        // No per-settle resync; flag a reconcile for the inflight-gated
        // background param poll to honor.
        if (s.alive) mirror.requestReconcile(false);
      } catch (err) {
        if (s.alive) {
          Log.error('writes', `scrub ${key} send failed`, err);
          s.health.noteFail(`scrub ${key}`, err);
          if (!s.health.degraded) {
            pushNotice('error', `Write failed: ${errMessage(err)}`);
            void forceResyncNow(s);
          }
        }
      } finally {
        sending = false;
        if (pending !== null) {
          pump();
        } else if (claimed) {
          mirror.dropInflight();
          claimed = false;
        }
      }
    })();
  }

  return {
    schedule(s, send) {
      pending = send;
      pendingSession = s;
      if (!claimed) {
        mirror.bumpInflight();
        claimed = true;
      }
      pump();
    },
    cancel() {
      pending = null;
      pendingSession = null;
      if (claimed) {
        mirror.dropInflight();
        claimed = false;
      }
    },
    async flushNow() {
      pump();
      while (sending || pending !== null) await chain;
    },
  };
}

export class WriteCoordinator {
  readonly inflightWrites = new Set<Promise<void>>();
  readonly lanes = new Map<string, Lane>();

  constructor(readonly mirror: MirrorState) {}

  laneFor(key: string): Lane {
    let lane = this.lanes.get(key);
    if (!lane) { lane = makeLane(key, this.mirror); this.lanes.set(key, lane); }
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

// Drag-paced write. Mutates the mirror immediately (optimistic, for drag feel at
// 60 fps), then sends right away or parks the latest value behind the in-flight
// send on the session's per-key lane, gating the settle on its `alive` flag.
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
