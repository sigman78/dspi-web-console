// Two-class write architecture for the device-first refactor.
//
// write()  — for click-paced controls. Await ack, then mutate the mirror.
//            No optimism, no coalescing. Failure triggers forceResyncNow.
//
// scrub()  — for drag-paced range sliders (added in Task B3).
//
// Both helpers respect the session.generation stale guard: a send that
// settles after a disconnect+reconnect is silently dropped (does not
// mutate, does not fire failure recovery).

import { session, setStatus } from '@/state';
import { bumpInflight, dropInflight } from '@/state/mirror.svelte';
import { forceResyncNow, scheduleResync } from '@/runtime/resync';
import { Log } from '@/utils';

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// Registry of in-flight write() promises so flushAllWrites can await them.
const inflightWrites = new Set<Promise<void>>();

// Click-paced write. Awaits the wire ack, mutates the mirror on success.
// On throw: flips status to 'error' and forces a resync to recover ground
// truth. The mutate is *never* applied on failure — the mirror never holds
// an optimistic value that didn't survive.
export async function write(
  send: () => Promise<unknown>,
  mutate: () => void,
): Promise<void> {
  const gen = session.generation;
  bumpInflight();
  const settled = (async () => {
    try {
      await send();
      if (gen === session.generation) mutate();
    } catch (err) {
      if (gen !== session.generation) return;
      Log.error('writes', 'write send failed; forcing resync', err);
      setStatus('error', errMessage(err));
      void forceResyncNow();
    } finally {
      dropInflight();
      inflightWrites.delete(settled);
    }
  })();
  inflightWrites.add(settled);
  return settled;
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
          if (gen === session.generation) scheduleResync();
        } catch (err) {
          if (gen !== session.generation) return;
          Log.error('writes', `scrub ${key} send failed; forcing resync`, err);
          setStatus('error', errMessage(err));
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

const lanes = new Map<string, Lane>();

function laneFor(key: string): Lane {
  let lane = lanes.get(key);
  if (!lane) { lane = makeLane(key, COALESCE_MS); lanes.set(key, lane); }
  return lane;
}

// Drag-paced write. Mutates the mirror immediately (optimistic — needed for
// drag feel at 60 fps), schedules a coalesced wire send per key, and arms
// a trailing resync on settle.
export function scrub(
  key: string,
  mutate: () => void,
  send: () => Promise<void>,
): void {
  mutate();
  laneFor(key).schedule(send);
}

// Drain every armed lane and wait for its in-flight send to settle. Used
// by preset transitions before issuing a flash command. Also awaits any
// in-flight write() operations (fire-and-forget click-paced writes).
export async function flushAllWrites(): Promise<void> {
  await Promise.all([
    ...[...lanes.values()].map((l) => l.flushNow()),
    ...[...inflightWrites],
  ]);
}

// Cancel every armed lane without firing. Used by the disconnect path.
// Also clears the inflightWrites registry: the generation guard already
// prevents stale settles from mutating or triggering recovery; clearing
// the registry ensures flushAllWrites on the next connection doesn't
// await ghosts from a prior session.
export function cancelAllWrites(): void {
  for (const lane of lanes.values()) lane.cancel();
  lanes.clear();
  inflightWrites.clear();
}
