// Action precondition layer (iteration 1).
//
// Splits the two failure kinds the action surface conflates today:
//   - NotReady       — a precondition (no device / no snapshot / absent
//                      section / missing data). Usually a benign race during
//                      disconnect, or a UI bug showing a control it shouldn't.
//   - DeviceRejected — an operational outcome: the device returned a non-ok
//                      status byte (pin in use, output active, ...).
//
// Resolvers return the resolved value or throw NotReady, so action bodies can
// assume their prerequisites and stay free of guard ladders. `send` translates
// a device-layer Result (firmware status codes live there) into a thrown
// DeviceRejected. `run` is the single boundary that catches both so a throw
// never escapes as an unhandled rejection.

import { session } from '@/state';
import { mirror } from '@/state/mirror.svelte';
import type { DspDevice } from '@/device/DspDevice';
import type { DspSnapshot, ChannelModel, I2sConfig, ChannelId } from '@/domain';
import { Log, Result, type VoidResult } from '@/utils';

// Precondition breach: the action cannot meaningfully run right now.
export class NotReady extends Error {
  constructor(readonly what: string) {
    super(`${what} not available`);
    this.name = 'NotReady';
  }
}

// Operational rejection: the device accepted the request but returned a
// non-ok status. `code` is the raw device-layer Result code (enum varies per
// command); `op` is a human label for surfacing/logging.
export class DeviceRejected extends Error {
  constructor(readonly op: string, message: string, readonly code?: unknown) {
    super(`${op}: ${message}`);
    this.name = 'DeviceRejected';
  }
}

// --- Resolvers: return the resolved prerequisite or throw NotReady ----------

export function device(): DspDevice {
  const d = session.device;
  if (!d) throw new NotReady('device');
  return d;
}

export function snapshot(): DspSnapshot {
  const m = mirror.current;
  if (!m) throw new NotReady('snapshot');
  return m;
}

export function i2s(): I2sConfig {
  const cfg = snapshot().i2s;
  if (!cfg) throw new NotReady('I2S config');
  return cfg;
}

export function channel(id: ChannelId): ChannelModel {
  const ch = snapshot().channels.find((c) => c.id === id);
  if (!ch) throw new NotReady(`channel ${id}`);
  return ch;
}

// --- Operational seam: Result (device layer) -> thrown DeviceRejected -------

export async function send<E>(op: string, call: () => Promise<VoidResult<E>>): Promise<void> {
  const r = await call();
  if (!r.ok) throw new DeviceRejected(op, r.message, r.code);
}

// --- Boundary: catch precondition/operational throws; never reject ----------
//
// Connection status is owned by the connection lifecycle, not by individual
// actions, so the boundary deliberately does NOT flip session.status here — a
// single failed action shouldn't mark the whole connection errored. User-facing
// surfacing of DeviceRejected (a toast) is a follow-up; for now it is logged.
function report(name: string, e: unknown): void {
  if (e instanceof NotReady)      { Log.debug('action', `${name} skipped`, e.what); return; }
  if (e instanceof DeviceRejected) { Log.warn('action', `${name} rejected`, e.op, e.message); return; }
  Log.error('action', `${name} failed`, e);
}

// Run an action body behind the boundary. Normalizes sync and async bodies to a
// Promise<void> that resolves whether the body succeeded or a throw was handled
// — it never rejects, so fire-and-forget callers can ignore it and awaiting
// callers can sequence on completion without a try/catch.
export function run(name: string, fn: () => void | Promise<void>): Promise<void> {
  return (async () => {
    try {
      await fn();
    } catch (e) {
      report(name, e);
    }
  })();
}

// Result-returning sibling of `run`, for actions whose caller surfaces the
// outcome (e.g. a panel showing an error message). Same boundary semantics —
// never rejects — but maps the throw kinds to a VoidResult: NotReady and
// DeviceRejected become typed failures; anything else is logged and returned as
// a generic failure. The device-layer numeric code collapses to the string
// channel here since callers display `message`, not `code`.
export async function capture(name: string, fn: () => void | Promise<void>): Promise<VoidResult> {
  try {
    await fn();
    return Result.ok();
  } catch (e) {
    if (e instanceof NotReady) {
      Log.debug('action', `${name} skipped`, e.what);
      return Result.fail('not ready', `${e.what} not available`);
    }
    if (e instanceof DeviceRejected) {
      Log.warn('action', `${name} rejected`, e.op, e.message);
      return Result.fail('rejected', e.message);
    }
    Log.error('action', `${name} failed`, e);
    return Result.fail('error', e instanceof Error ? e.message : String(e));
  }
}
