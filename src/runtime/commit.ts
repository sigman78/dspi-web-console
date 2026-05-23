import type { DspSnapshot, HardwareProfile } from '@/domain';
import { toBulkParams } from '@/device/snapshotCodec';
import type { BulkParams } from '@/protocol';
import { dsp, session, setStatus, applyBulkBaseline } from '@/state';
import { forceResyncNow } from './resync';
import { Log } from '@/utils';

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// Tier-B bulk-write coordination. Module-private: not part of the public store.
const flush = {
  inflight: null as Promise<void> | null,
  currentRev: 0,
  lastSentRev: 0,
};

// Apply a freshly-fetched device packet as the new baseline AND mark the bulk
// lane converged (no unsent edits). The convergence reset lives here, not in the
// state layer's applyBaseline, because the state layer cannot import the runtime
// layer that owns these counters. Pairing both steps in one verb keeps call
// sites from drifting. Use on connect, factory reset, and preset transitions.
export function applyBulkBaselineConverged(hardware: HardwareProfile, bulk: BulkParams): void {
  applyBulkBaseline(hardware, bulk);
  flush.currentRev = 0;
  flush.lastSentRev = 0;
}

// Single token mirroring "bulk edits unsent or in flight" into dsp.pendingWrites,
// so the resync soft-skip guard (resync.ts) — which checks pendingWrites.size —
// covers the bulk lane as well as the per-item scrub lane. Also lights the UI
// dirty dot (isInFlight) for Tier B edits. The token tracks a computed predicate
// rather than being added/removed at scattered call sites, so it can never get
// out of balance.
const BULK_TOKEN = Symbol('bulk');

function syncBulkToken(): void {
  const pending = flush.currentRev > flush.lastSentRev || flush.inflight !== null;
  if (pending) dsp.pendingWrites.add(BULK_TOKEN);
  else dsp.pendingWrites.delete(BULK_TOKEN);
}

// The single bulk write verb. Mutates `dsp.live` optimistically, bumps the
// revision counter, and fires a bulk send if the lane is idle. Sends ride
// each other's completion -- no timers, no per-key state. All Tier B actions
// route here (or commitBulkDebounced).
export function commitBulk(mutator: (snap: DspSnapshot) => void): void {
  if (!dsp.live) return;
  mutator(dsp.live);
  flush.currentRev += 1;
  syncBulkToken();
  flushBulkIfIdle();
}

function flushBulkIfIdle(): void {
  if (flush.inflight || !dsp.live || !dsp.wireBase) return;
  const d = session.device;
  if (!d) return;
  const sendingRev = flush.currentRev;
  const gen = session.generation;
  const bulk = toBulkParams(d.hardware, dsp.live, dsp.wireBase);
  // The in-flight promise is its own run identity. Only the send that still
  // owns flush.inflight tears down the lane: a send detached mid-flight by
  // cancelBulkFlush() — after which a fresh commitBulk() starts a new send —
  // must not, on its late settle, null the newer send's slot or fire a
  // spurious re-flush. The generation guard below protects the *data*
  // (wireBase/lastSentRev); this identity check guards the *lane
  // bookkeeping* in finally, which is not generation-gated. See the
  // "detached stale send" test in commit.test.ts.
  let run: Promise<void> | null = null;
  run = (async () => {
    try {
      await d.setAllParams(bulk);
      if (gen !== session.generation) return;   // stale settle: silent no-op
      dsp.wireBase = bulk;                        // device now holds this packet
      flush.lastSentRev = sendingRev;
    } catch (err) {
      if (gen !== session.generation) return;
      Log.error('commit', 'bulk write failed; forcing resync', err);
      setStatus('error', errMessage(err));
      void forceResyncNow();
    } finally {
      if (flush.inflight === run) {
        flush.inflight = null;
        // Re-flush only while connected (an error status pauses the lane)
        // and only if newer edits arrived during the send.
        if (session.status === 'connected' && flush.currentRev > flush.lastSentRev) {
          flushBulkIfIdle();
        }
        syncBulkToken();
      }
    }
  })();
  flush.inflight = run;
  syncBulkToken();
}

const TRAILING_MS = 16;
const trailingTimers = new Map<string, ReturnType<typeof setTimeout>>();

// Tier B "rare numeric slider" path. Applies the mutator to `live`
// immediately, but defers the bulk send until the key has been idle for
// TRAILING_MS -- one settled write per drag instead of one per frame.
export function commitBulkDebounced(key: string, mutator: (snap: DspSnapshot) => void): void {
  if (!dsp.live) return;
  mutator(dsp.live);
  flush.currentRev += 1;
  syncBulkToken();
  const existing = trailingTimers.get(key);
  if (existing) clearTimeout(existing);
  trailingTimers.set(key, setTimeout(() => {
    trailingTimers.delete(key);
    flushBulkIfIdle();
  }, TRAILING_MS));
}

// Converge: fire one bulk send if edits landed since the last sent revision.
// Used by the outbox coordinator (flushPending) and as the trailing-timer
// drain's flush step.
export function convergeBulk(): void {
  if (flush.currentRev > flush.lastSentRev) flushBulkIfIdle();
}

// Clear every armed debounced trailing timer and converge any pending edit.
// First drain category used by outbox.flushPending().
export function drainTrailingTimers(): void {
  for (const t of trailingTimers.values()) clearTimeout(t);
  trailingTimers.clear();
  convergeBulk();
}

// Await the in-flight bulk send, if one is parked.
export async function awaitBulkSettled(): Promise<void> {
  if (flush.inflight) await flush.inflight;
}

// Reset the bulk-write coordination. Called by cancelAllCommands on
// disconnect/cancel. The in-flight promise (if any) self-cancels via the
// generation guard; we detach it here.
export function cancelBulkFlush(): void {
  for (const t of trailingTimers.values()) clearTimeout(t);
  trailingTimers.clear();
  flush.inflight = null;
  flush.currentRev = 0;
  flush.lastSentRev = 0;
  syncBulkToken();
}
