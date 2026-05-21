import type { DspSnapshot } from '@/domain';
import { toBulkParams } from '@/domain';
import { dsp, session, setStatus } from '@/state';
import { forceResyncNow } from './resync';
import { Log } from '@/utils';

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

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
    }
  })();
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
  const existing = trailingTimers.get(key);
  if (existing) clearTimeout(existing);
  trailingTimers.set(key, setTimeout(() => {
    trailingTimers.delete(key);
    flushBulkIfIdle();
  }, TRAILING_MS));
}

// Drain every pending write category so a following flash op (preset
// save/load/paste) sees settled device state. Order: fire debounced trailing
// timers, drain Tier-A scrub lanes, await Tier-B in-flight, then one
// converging flush if a new edit landed mid-drain. See docs/IDEAS.md §10.2.
export async function flushPending(): Promise<void> {
  for (const [key, t] of trailingTimers) { clearTimeout(t); trailingTimers.delete(key); }
  if (dsp.flush.currentRev > dsp.flush.lastSentRev) flushBulkIfIdle();
  const { drainScrubLanes } = await import('./commands');
  await drainScrubLanes();
  if (dsp.flush.inflight) await dsp.flush.inflight;
  if (dsp.flush.currentRev > dsp.flush.lastSentRev) {
    flushBulkIfIdle();
    if (dsp.flush.inflight) await dsp.flush.inflight;
  }
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
}
