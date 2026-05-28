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
import { bumpInflight, dropInflight } from './mirror.svelte';
import { forceResyncNow } from '@/runtime/resync';
import { Log } from '@/utils';

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
  bumpInflight();
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
  }
}
