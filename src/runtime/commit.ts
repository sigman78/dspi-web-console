import type { DspSnapshot } from '@/domain';
import { toBulkParams } from '@/domain';
import { dsp, session, setStatus } from '@/state';
import { forceResyncNow } from './resync';
import { Log } from '@/utils';

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// Generation stamp of the in-flight send. Compared against session.generation
// so a stale inflight pointer left by a previous session does not block a new
// one from starting.
let inflightGen: number = -1;

// The single bulk write verb. Mutates `dsp.live` optimistically, bumps the
// revision counter, and fires a bulk send if the lane is idle. Sends ride
// each other's completion -- no timers, no per-key state. See docs/IDEAS.md
// §5.4 / §8.3. NOT yet called by any action (Phase 3 reroutes Tier B here).
export function commitBulk(mutator: (snap: DspSnapshot) => void): void {
  if (!dsp.live) return;
  mutator(dsp.live);
  dsp.flush.currentRev += 1;
  flushBulkIfIdle();
}

function flushBulkIfIdle(): void {
  // Capability gate: pre-V6 firmware can't accept the V6 bulk layout.
  if (!session.capabilities.setAllParams) return;
  // A non-null inflight is only a real blocker when it belongs to the
  // current session (same generation). A leftover pointer from a previous
  // session is stale and must not prevent a fresh send.
  if (dsp.flush.inflight && inflightGen === session.generation) return;
  if (!dsp.live || !dsp.baselineBulk) return;
  const d = session.device;
  if (!d) return;
  const sendingRev = dsp.flush.currentRev;
  const gen = session.generation;
  const bulk = toBulkParams(d.hardware, dsp.live, dsp.baselineBulk);
  inflightGen = gen;
  dsp.flush.inflight = (async () => {
    try {
      await d.setAllParams(bulk);
      if (gen !== session.generation) return;   // stale settle: silent no-op
      dsp.baselineBulk = bulk;                   // device now holds this packet
      dsp.flush.lastSentRev = sendingRev;
      dsp.flush.failureCount = 0;
    } catch (err) {
      if (gen !== session.generation) return;
      Log.error('commit', 'bulk write failed; forcing resync', err);
      setStatus('error', errMessage(err));
      dsp.flush.failureCount += 1;
      void forceResyncNow();
    } finally {
      dsp.flush.inflight = null;
      // Re-flush only while connected (an error status pauses the lane,
      // §10.3) and only if newer edits arrived during the send.
      // Deferred two microtask ticks so the caller's `await inflight`
      // sees null before the next send begins — the coalescing test
      // relies on this ordering (see docs/IDEAS.md §8.3). The generation
      // guard prevents a re-flush after a session change mid-flight.
      if (session.status === 'connected' && dsp.flush.currentRev > dsp.flush.lastSentRev) {
        const capturedGen = gen;
        void Promise.resolve().then(() =>
          Promise.resolve().then(() => {
            if (session.generation === capturedGen) flushBulkIfIdle();
          })
        );
      }
    }
  })();
}

// Reset the bulk-write coordination. Called by cancelAllCommands on
// disconnect/cancel. The in-flight promise (if any) self-cancels via the
// generation guard; we detach it here.
export function cancelBulkFlush(): void {
  dsp.flush.inflight = null;
  dsp.flush.currentRev = 0;
  dsp.flush.lastSentRev = 0;
  dsp.flush.failureCount = 0;
}
