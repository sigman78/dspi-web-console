import type { DspSnapshot } from '@/domain';
import { toBulkParams } from '@/domain';
import { dsp, session, setStatus } from '@/state';
import { forceResyncNow } from './resync';
import { Log } from '@/utils';

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// Single token mirroring "bulk edits unsent or in flight" into dsp.pendingWrites,
// so the resync soft-skip guard (resync.ts) — which checks pendingWrites.size —
// covers the bulk lane as well as the per-item scrub lane. Also lights the UI
// dirty dot (isInFlight) for Tier B edits. The token tracks a computed predicate
// rather than being added/removed at scattered call sites, so it can never get
// out of balance. See docs/IDEAS.md §11.6 Finding 1.
const BULK_TOKEN = Symbol('bulk');
function syncBulkToken(): void {
  const pending = dsp.flush.currentRev > dsp.flush.lastSentRev || dsp.flush.inflight !== null;
  if (pending) dsp.pendingWrites.add(BULK_TOKEN);
  else dsp.pendingWrites.delete(BULK_TOKEN);
}

// The single bulk write verb. Mutates `dsp.live` optimistically, bumps the
// revision counter, and fires a bulk send if the lane is idle. Sends ride
// each other's completion -- no timers, no per-key state. See docs/IDEAS.md
// §5.4 / §8.3. All Tier B actions route here (or commitBulkDebounced).
export function commitBulk(mutator: (snap: DspSnapshot) => void): void {
  if (!dsp.live) return;
  mutator(dsp.live);
  dsp.flush.currentRev += 1;
  syncBulkToken();
  flushBulkIfIdle();
}

function flushBulkIfIdle(): void {
  if (dsp.flush.inflight || !dsp.live || !dsp.baselineBulk) return;
  const d = session.device;
  if (!d) return;
  const sendingRev = dsp.flush.currentRev;
  const gen = session.generation;
  const bulk = toBulkParams(d.hardware, dsp.live, dsp.baselineBulk);
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
      if (session.status === 'connected' && dsp.flush.currentRev > dsp.flush.lastSentRev) {
        flushBulkIfIdle();
      }
      syncBulkToken();
    }
  })();
  syncBulkToken();
}

const TRAILING_MS = 16;
const trailingTimers = new Map<string, ReturnType<typeof setTimeout>>();

// Tier B "rare numeric slider" path (docs/IDEAS.md §9.3). Applies the mutator
// to `live` immediately, but defers the bulk send until the key has been idle
// for TRAILING_MS -- one settled write per drag instead of one per frame.
export function commitBulkDebounced(key: string, mutator: (snap: DspSnapshot) => void): void {
  if (!dsp.live) return;
  mutator(dsp.live);
  dsp.flush.currentRev += 1;
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
  if (dsp.flush.currentRev > dsp.flush.lastSentRev) flushBulkIfIdle();
}

// Clear every armed debounced trailing timer and converge any pending edit.
// (docs/IDEAS.md §10.2 — the first of the three drain categories.)
export function drainTrailingTimers(): void {
  for (const t of trailingTimers.values()) clearTimeout(t);
  trailingTimers.clear();
  convergeBulk();
}

// Await the in-flight bulk send, if one is parked.
export async function awaitBulkSettled(): Promise<void> {
  if (dsp.flush.inflight) await dsp.flush.inflight;
}

// Reset the bulk-write coordination. Called by cancelAllCommands on
// disconnect/cancel. The in-flight promise (if any) self-cancels via the
// generation guard; we detach it here.
export function cancelBulkFlush(): void {
  for (const t of trailingTimers.values()) clearTimeout(t);
  trailingTimers.clear();
  dsp.flush.inflight = null;
  dsp.flush.currentRev = 0;
  dsp.flush.lastSentRev = 0;
  dsp.flush.failureCount = 0;
  syncBulkToken();
}
