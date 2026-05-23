// Unified write outbox (ADR-001). Collapses the former granular and bulk write
// lanes and their cross-lane coordinator into a single module behind one
// `enqueue`. Routing is driven by the declarative CONTROL_POLICY table: a
// control is either 'granular' (per-item, latency-sensitive; trailing resync)
// or 'bulk' (SetAllParams; self-converging), optionally debounced.
//
// The granular machinery (lanes/runGuarded/claimToken) and the bulk machinery
// (bulk state/BULK_TOKEN/flushBulkIfIdle) are module-private; the store-facing
// API is enqueue / flush / cancel / applyBaselineConverged. (convergeBulk,
// awaitBulkSettled and cancelBulkFlush are also exported, but only as test seams.)
import type { DspDevice } from '@/device/DspDevice';
import type { DspSnapshot } from '@/domain';
import { dsp, session, setStatus, applyBaselineSnapshot } from '@/state';
import { forceResyncNow, scheduleResync } from './resync';
import { Log } from '@/utils';
import { CONTROL_POLICY, type ControlName } from './controlPolicy';

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ---------------------------------------------------------------------------
// Granular machinery — per-item coalescing-lane registry for latency-sensitive
// scrub gestures (slider/knob drags). enqueueGranular captures
// session.generation when its send is launched and gates post-send side effects
// (status flip, resync schedule) on equality with the current generation.
// ---------------------------------------------------------------------------

function claimToken(label: string): symbol {
  const t = Symbol(label);
  dsp.pendingWrites.add(t);
  return t;
}

// Run a wire send under the generation guard. Token is dropped on settle
// (always); status flip + forced resync happen only when current gen still
// matches the captured gen -- stale sends settle silently.
async function runGuarded(
  label: string,
  token: symbol,
  gen: number,
  send: () => Promise<void>,
): Promise<void> {
  try {
    await send();
    // All granular controls converge via 'resync' today (controlPolicy.ts);
    // the type allows 'self' for future use but no granular control uses it.
    if (gen === session.generation) scheduleResync();
  } catch (err) {
    if (gen !== session.generation) return;
    Log.error('outbox', `${label} send failed; forcing resync`, err);
    setStatus('error', errMessage(err));
    void forceResyncNow();
  } finally {
    dsp.pendingWrites.delete(token);
  }
}

const GRANULAR_COALESCE_MS = 16;

interface Lane {
  schedule(thunk: () => Promise<void>): void;
  cancel(): void;
  flushNow(): Promise<void>;
}

const granularLanes = new Map<string, Lane>();

function makeLane(key: string, ms: number): Lane {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: (() => Promise<void>) | null = null;
  let pendingToken: symbol | null = null;
  let inFlight: Promise<void> = Promise.resolve();

  function fire(): void {
    // schedule() guarantees pending + pendingToken non-null at fire time
    timer = null;
    const thunk = pending!;
    const token = pendingToken!;
    const gen = session.generation;  // captured BEFORE the inFlight chain
    pending = null;
    pendingToken = null;
    inFlight = inFlight
      .catch(() => undefined)
      .then(() => runGuarded(`granular ${key}`, token, gen, thunk));
  }

  return {
    schedule(thunk) {
      pending = thunk;
      if (pendingToken === null) pendingToken = claimToken(`granular:${key}`);
      if (timer === null) timer = setTimeout(fire, ms);
    },
    cancel() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      pending = null;
      if (pendingToken !== null) {
        dsp.pendingWrites.delete(pendingToken);
        pendingToken = null;
      }
    },
    flushNow() {
      if (timer !== null) { clearTimeout(timer); fire(); }
      return inFlight;
    },
  };
}

// Granular enqueue path. Apply the optimistic patch, then schedule the per-key
// coalescing lane (16ms latest-wins).
function enqueueGranular(key: string, apply: () => void, send: (d: DspDevice) => Promise<void>): void {
  apply();
  const d = session.device;
  if (!d) return;
  let lane = granularLanes.get(key);
  if (!lane) {
    lane = makeLane(key, GRANULAR_COALESCE_MS);
    granularLanes.set(key, lane);
  }
  lane.schedule(() => send(d));
}

async function drainGranularLanes(): Promise<void> {
  await Promise.all([...granularLanes.values()].map((l) => l.flushNow()));
}

// Cancel every granular lane. The session-wide teardown (generation bump,
// pendingWrites clear, bulk-flush reset) lives in cancel() below.
function cancelAllGranularLanes(): void {
  for (const lane of granularLanes.values()) lane.cancel();
  granularLanes.clear();
}

// ---------------------------------------------------------------------------
// Bulk machinery — bulk-write (SetAllParams) coordination.
// Module-private: not part of the public store.
// ---------------------------------------------------------------------------

const bulk = {
  inflight: null as Promise<void> | null,
  currentRev: 0,
  lastSentRev: 0,
};

// Apply a freshly-fetched packet as the new baseline AND mark the bulk lane
// converged. Lives here (not in the state layer) because only the runtime owns
// these counters. Use on connect, factory reset, and preset transitions.
export function applyBaselineConverged(snapshot: DspSnapshot): void {
  applyBaselineSnapshot(snapshot);
  bulk.currentRev = 0;
  bulk.lastSentRev = 0;
}

// Mirrors "bulk edits unsent or in flight" into dsp.pendingWrites so the resync
// soft-skip guard and the UI dirty dot cover the bulk lane too. Derived from a
// computed predicate (syncBulkToken) so it can't get out of balance.
const BULK_TOKEN = Symbol('bulk');

function syncBulkToken(): void {
  const pending = bulk.currentRev > bulk.lastSentRev || bulk.inflight !== null;
  if (pending) dsp.pendingWrites.add(BULK_TOKEN);
  else dsp.pendingWrites.delete(BULK_TOKEN);
}

function flushBulkIfIdle(): void {
  if (bulk.inflight || !dsp.draft) return;
  const d = session.device;
  if (!d || !d.hasState) return;
  const sendingRev = bulk.currentRev;
  const gen = session.generation;
  const draft = dsp.draft;
  // Only the send that still owns bulk.inflight tears down the lane: a send
  // detached mid-flight by cancelBulkFlush() must not, on its late settle, null
  // the newer send's slot or fire a spurious re-flush. The generation guard
  // protects the data (lastSentRev); this identity check guards the lane
  // bookkeeping in finally, which is not generation-gated.
  let run: Promise<void> | null = null;
  run = (async () => {
    try {
      await d.applyBulk(draft);
      if (gen !== session.generation) return;   // stale settle: silent no-op
      bulk.lastSentRev = sendingRev;
    } catch (err) {
      if (gen !== session.generation) return;
      Log.error('outbox', 'bulk write failed; forcing resync', err);
      setStatus('error', errMessage(err));
      void forceResyncNow();
    } finally {
      if (bulk.inflight === run) {
        bulk.inflight = null;
        // Re-flush only while connected (an error status pauses the lane)
        // and only if newer edits arrived during the send.
        if (session.status === 'connected' && bulk.currentRev > bulk.lastSentRev) {
          flushBulkIfIdle();
        }
        syncBulkToken();
      }
    }
  })();
  bulk.inflight = run;
  syncBulkToken();
}

const trailingTimers = new Map<string, ReturnType<typeof setTimeout>>();

// Converge: fire one bulk send if edits landed since the last sent revision.
// Used by flush() and as the trailing-timer drain's flush step.
export function convergeBulk(): void {
  if (bulk.currentRev > bulk.lastSentRev) flushBulkIfIdle();
}

// Clear every armed debounced trailing timer and converge any pending edit.
// First drain category used by flush().
function drainTrailingTimers(): void {
  for (const t of trailingTimers.values()) clearTimeout(t);
  trailingTimers.clear();
  convergeBulk();
}

// Await the in-flight bulk send, if one is parked.
export async function awaitBulkSettled(): Promise<void> {
  if (bulk.inflight) await bulk.inflight;
}

// Reset the bulk-write coordination. Called by cancel() on disconnect/cancel.
// The in-flight promise (if any) self-cancels via the generation guard; we
// detach it here.
export function cancelBulkFlush(): void {
  for (const t of trailingTimers.values()) clearTimeout(t);
  trailingTimers.clear();
  bulk.inflight = null;
  bulk.currentRev = 0;
  bulk.lastSentRev = 0;
  syncBulkToken();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

interface GranularIntent {
  control: ControlName;
  coalesceKey: string;
  apply: () => void;
  send: (d: DspDevice) => Promise<void>;
}

interface BulkIntent {
  control: ControlName;
  debounceKey?: string;
  mutate: (s: DspSnapshot) => void;
}

type WriteIntent = GranularIntent | BulkIntent;

function isGranular(intent: WriteIntent): intent is GranularIntent {
  return 'send' in intent;
}

// The single write verb. Reads CONTROL_POLICY[intent.control] and routes the
// intent to the granular lane or the bulk lane. A runtime assertion keeps
// a granular intent from ever hitting the bulk branch (and vice-versa) even if
// the policy table and the intent shape disagree.
export function enqueue(intent: WriteIntent): void {
  const policy = CONTROL_POLICY[intent.control];
  if (policy.strategy === 'granular') {
    if (!isGranular(intent)) {
      throw new Error(`outbox: control '${intent.control}' is granular but intent has no send()`);
    }
    enqueueGranular(intent.coalesceKey, intent.apply, intent.send);
    return;
  }
  // strategy === 'bulk'
  if (isGranular(intent)) {
    throw new Error(`outbox: control '${intent.control}' is bulk but intent has a send()`);
  }
  if (!dsp.draft) return;
  intent.mutate(dsp.draft);
  bulk.currentRev += 1;
  syncBulkToken();
  const debounceMs = 'debounceMs' in policy ? policy.debounceMs : undefined;
  if (debounceMs !== undefined) {
    const key = intent.debounceKey ?? intent.control;
    const existing = trailingTimers.get(key);
    if (existing) clearTimeout(existing);
    trailingTimers.set(key, setTimeout(() => {
      trailingTimers.delete(key);
      flushBulkIfIdle();
    }, debounceMs));
  } else {
    flushBulkIfIdle();
  }
}

// Drain every pending write category so a following flash op (preset
// save/load/paste) sees settled device state. Order: trailing timers + converge,
// drain granular lanes, await bulk in-flight, then one converging flush if
// a new edit landed mid-drain.
export async function flush(): Promise<void> {
  drainTrailingTimers();
  await drainGranularLanes();
  await awaitBulkSettled();
  convergeBulk();
  await awaitBulkSettled();
}

// Teardown for disconnect/cancel. Cancels granular lanes, bumps the generation so
// any in-flight send settles as a stale no-op, clears the optimistic-write
// token set, and resets the bulk-flush coordination.
export function cancel(): void {
  cancelAllGranularLanes();
  session.generation += 1;
  dsp.pendingWrites.clear();
  cancelBulkFlush();
}
