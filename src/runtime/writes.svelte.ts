// Write lanes for the device-first model: a runtime action routes its wire send
// through one of these, which coordinates the mirror mutation, the reconcile
// signal, and failure recovery. Each lane operates on the session it is GIVEN
// (never the ambient active session), so busy/alive/reconcile bookkeeping
// always lands on the session the send/mutate closures target, even across a
// reconnect or switch. Every send is serialized through the session's
// CommandQueue (`s.queue`), so it can never interleave with a concurrent
// snapshot fetch.
//
// write()        -- click-paced. Await ack, then mutate. Failure -> toast +
//                   forceResyncNow; link health decides anything bigger.
// scrub()        -- drag-paced sliders. Optimistic mutate + latest-wins lane.
// writeChecked() -- commit-paced commands returning a typed Result. A non-ok is a
//                   local device rejection (warn toast), not a connection error.
//
// All respect the per-session `alive` guard: a send that settles after its
// session was disposed (disconnect) is silently dropped (no mutate, no recovery).

import { SvelteSet, SvelteMap } from 'svelte/reactivity';
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
  s.writes.claim();
  const settled = (async () => {
    try {
      await s.queue.run(send);
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
      s.writes.release();
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
  opts: { queued?: boolean } = {},
): Promise<void> {
  s.writes.claim();
  const settled = (async () => {
    try {
      // queued: false is for compound sends with a non-wire gap in the middle
      // (a firmware settle wait): they queue each wire call themselves so the
      // gap doesn't stall the whole session queue. The claim spans the full
      // send either way, so the param reconcile can't interleave with the gap.
      const r = opts.queued === false ? await send() : await s.queue.run(send);
      if (s.alive) onSettled(r, s);
    } catch (err) {
      if (!s.alive) return;
      Log.error('writes', `${op} failed`, err);
      s.health.noteFail(op, err);
      if (!s.health.degraded) pushNotice('error', `${op} failed`);
    } finally {
      s.writes.release();
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

function makeLane(key: string, coordinator: WriteCoordinator): Lane {
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
        await s.queue.run(thunk);
        // The optimistic mutate already left the mirror at the value we sent.
        // No per-settle resync; flag a reconcile for the busy-gated
        // background param poll to honor.
        if (s.alive) coordinator.mirror.requestReconcile(false);
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
          coordinator.release();
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
        coordinator.claim();
        claimed = true;
      }
      pump();
    },
    cancel() {
      pending = null;
      pendingSession = null;
      if (claimed) {
        coordinator.release();
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
  // Counts registered-unsettled write()/command() ops plus lanes that are
  // currently sending or hold a parked (coalesced) value. Exact -- no timing
  // component -- because every device control call funnels through the
  // session's CommandQueue, so a fetch can never interleave with a send.
  #active = $state(0);
  readonly inflightWrites = new SvelteSet<Promise<void>>();
  readonly lanes = new SvelteMap<string, Lane>();

  constructor(readonly mirror: MirrorState) {}

  get busy(): boolean { return this.#active > 0; }
  claim(): void { this.#active += 1; }
  release(): void { if (this.#active > 0) this.#active -= 1; }

  laneFor(key: string): Lane {
    let lane = this.lanes.get(key);
    if (!lane) { lane = makeLane(key, this); this.lanes.set(key, lane); }
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
  mutate();
  s.writes.laneFor(key).schedule(s, send);
}

// Drain the given session's armed lanes and await its in-flight write()
// operations. Used by preset transitions before issuing a flash command.
export async function flushAllWrites(s: ReadySession): Promise<void> {
  await s.writes.flush();
}
