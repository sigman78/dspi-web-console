import type { DspDevice } from '@/device/DspDevice';
import { dsp, session, setStatus } from '@/state';
import { forceResyncNow, scheduleResync } from './resync';
import { Log } from '@/utils';

// commands.ts owns three command shapes plus a per-key scrub-lane registry.
// All commands capture session.generation when their send is launched and
// gate post-send side effects (status flip, resync schedule) on equality
// with the current generation. cancelAllScrubLanes() lives here and cancels
// lanes only; session-wide teardown (generation bump, pendingWrites clear,
// bulk-flush reset) lives in outbox.cancelAllCommands().

// Internals ---

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

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
    if (gen === session.generation) scheduleResync();
  } catch (err) {
    if (gen !== session.generation) return;
    Log.error('command', `${label} send failed; forcing resync`, err);
    setStatus('error', errMessage(err));
    void forceResyncNow();
  } finally {
    dsp.pendingWrites.delete(token);
  }
}

// Instant ---

export interface InstantOpts {
  apply(): void;
  send(d: DspDevice): Promise<void>;
}

export function instantCommand(opts: InstantOpts): void {
  opts.apply();
  const d = session.device;
  if (!d) return;
  void runGuarded(
    'instant',
    claimToken('instant'),
    session.generation,
    () => opts.send(d),
  );
}

// Scrub lanes ---

const SCRUB_MS = 16;

interface Lane {
  schedule(thunk: () => Promise<void>): void;
  cancel(): void;
  flushNow(): Promise<void>;
}

const scrubLanes = new Map<string, Lane>();

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
      .then(() => runGuarded(`scrub ${key}`, token, gen, thunk));
  }

  return {
    schedule(thunk) {
      pending = thunk;
      if (pendingToken === null) pendingToken = claimToken(`scrub:${key}`);
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

// Scrub ---

export interface ScrubOpts {
  key: string;
  apply(): void;
  send(d: DspDevice): Promise<void>;
}

export function scrubCommand(opts: ScrubOpts): void {
  opts.apply();
  const d = session.device;
  if (!d) return;
  let lane = scrubLanes.get(opts.key);
  if (!lane) {
    lane = makeLane(opts.key, SCRUB_MS);
    scrubLanes.set(opts.key, lane);
  }
  lane.schedule(() => opts.send(d));
}

export function cancelScrubLane(key: string): void {
  const lane = scrubLanes.get(key);
  if (!lane) return;
  lane.cancel();
  scrubLanes.delete(key);
}

// Batch ---

export interface BatchOpts {
  apply(): void;
  send(d: DspDevice): Promise<void>;
}

export function batchCommand(opts: BatchOpts): void {
  opts.apply();
  const d = session.device;
  if (!d) return;
  void runGuarded(
    'batch',
    claimToken('batch'),
    session.generation,
    () => opts.send(d),
  );
}

export async function drainScrubLanes(): Promise<void> {
  await Promise.all([...scrubLanes.values()].map((l) => l.flushNow()));
}

// Cancelation ---

// Cancel every scrub lane. The session-wide teardown (generation bump,
// pendingWrites clear, bulk-flush reset) lives in outbox.cancelAllCommands.
export function cancelAllScrubLanes(): void {
  for (const lane of scrubLanes.values()) lane.cancel();
  scrubLanes.clear();
}
