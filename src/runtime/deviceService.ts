// Connection & whole-device service operations, split out from actions.ts
// (which holds the granular per-parameter verbs). Everything here touches the
// whole session or the whole snapshot: connect/sync/reconcile, transport-event
// wiring, and the factory-reset command -- as opposed to a single mirror field.

import type { DspTransport } from '@/transport/DspTransport';
import type { DspDevice } from '@/device/DspDevice';
import {
  settings, reconcileSelectedChannel, selectionVisibilityOf,
  pushNotice,
  dispatch, makeReadySession, activeSession, activeRecord, recordOf, mintConnId,
  type ReadySession, type ConnId, type DeviceRecord,
} from '@/state';
import { Log, errMessage } from '@/utils';
import * as Domain from '@/domain';
import { flushAllWrites } from './writes.svelte';
import { startPolling } from './poll';
import { startNotifyChannel } from './notifyChannel';
import { startLinkProbe } from './linkProbe';
import type { ConnectionScope } from './connectionScope';
import { fetchPresetInfo, invalidatePresetCache } from './presets';

// Per-session dedupe, keyed by identity rather than a single global slot: two
// sessions (one active, one dormant) must be able to sync concurrently.
const inflightSync = new WeakMap<ReadySession, Promise<void>>();

// Eager + lazy entry point for the V16 external control interfaces, mirroring
// fetchPresetInfo: idempotent once populated, never throws (errors land in
// lastFetchError). No-ops on a device that lacks the feature (V10).
export async function fetchCtrlIfaceInfo(s: ReadySession): Promise<void> {
  if (!s.device.capabilities.features.controlInterfaces) return;
  if (s.ctrlIfaces.uart != null) return;
  const d = s.device;
  s.ctrlIfaces.busy = true;
  try {
    const [uart, i2c, status] = await Promise.all([
      s.queue.run(() => d.getUartControlConfig()),
      s.queue.run(() => d.getI2cControlConfig()),
      s.queue.run(() => d.getControlIfaceStatus()),
    ]);
    s.ctrlIfaces.uart = uart;
    s.ctrlIfaces.i2c = i2c;
    s.ctrlIfaces.status = status;
    s.ctrlIfaces.lastFetchError = null;
  } catch (err) {
    s.ctrlIfaces.lastFetchError = errMessage(err);
    Log.warn('ctrlIfaces', 'fetch failed', err);
  } finally {
    s.ctrlIfaces.busy = false;
  }
}

// Minimum GetCsCaps format version this console understands (section 11.1 of
// the spec adds the v3 IR/preview tail, but the v2 preview model -- event/
// target/index, units, dirty/save/revert -- is the floor this panel needs).
export const MIN_CS_CAPS_VERSION = 2;
// Newest caps format the console models (v3 = the IR/preview tail).
export const MAX_KNOWN_CS_CAPS_VERSION = 3;

// Control Surfaces mirror of fetchCtrlIfaceInfo: caps (host order: header,
// then per-noun descriptors -- DspDevice owns that loop), live status, then
// every slot's binding and name. Idempotent once caps are populated; never
// throws. A capability format below MIN_CS_CAPS_VERSION leaves caps null (the
// panel stays gated) with an explanatory lastFetchError instead of trying to
// render a v1 device against v2+ assumptions.
export async function fetchControlSurfaces(s: ReadySession): Promise<void> {
  if (!s.device.capabilities.features.controlSurfaces) return;
  if (s.controlSurfaces.caps != null) return;
  const d = s.device;
  s.controlSurfaces.busy = true;
  try {
    const { caps, nouns } = await s.queue.run(() => d.getCsCaps());
    s.controlSurfaces.deviceCapsVersion = caps.capsVersion;
    if (caps.capsVersion < MIN_CS_CAPS_VERSION) {
      s.controlSurfaces.lastFetchError =
        `This device's Control Surfaces protocol (v${caps.capsVersion}) predates the version this console requires (v${MIN_CS_CAPS_VERSION}+). Update the device firmware.`;
      return;
    }
    const status = await s.queue.run(() => d.getCsStatus());
    const bindings: (Domain.CsBinding | null)[] = [];
    const names: string[] = [];
    for (let slot = 0; slot < caps.maxBindings; slot++) {
      const b = await s.queue.run(() => d.getCsBinding(slot));
      bindings.push(b.type === Domain.CsType.None ? null : b);
      names.push(await s.queue.run(() => d.getCsName(slot)));
    }
    let irCommands: (Domain.CsIrCommand | null)[] | null = null;
    if (caps.maxIrCommands > 0) {
      irCommands = [];
      for (let sub = 0; sub < caps.maxIrCommands; sub++) {
        const cmd = await s.queue.run(() => d.getCsIrCmd(sub));
        irCommands.push(cmd.protocol === Domain.CsIrProto.None ? null : cmd);
      }
    }
    s.controlSurfaces.caps = caps;
    s.controlSurfaces.nouns = nouns;
    s.controlSurfaces.status = status;
    s.controlSurfaces.bindings = bindings;
    s.controlSurfaces.names = names;
    if (irCommands) s.controlSurfaces.irCommands = irCommands;
    s.controlSurfaces.lastFetchError = null;
  } catch (err) {
    s.controlSurfaces.lastFetchError = errMessage(err);
    Log.warn('controlSurfaces', 'fetch failed', err);
  } finally {
    s.controlSurfaces.busy = false;
  }
}

export async function syncDeviceSnapshot(s: ReadySession): Promise<void> {
  const existing = inflightSync.get(s);
  if (existing) return existing;
  const d = s.device;
  const p = (async () => {
    try {
      const snap = await s.queue.run(() => d.getSnapshot());
      s.mirror.init(snap);
    } catch (err) {
      Log.error('sync', 'syncDeviceSnapshot failed', err);
      s.health.noteFail('sync', err);
      throw err;
    } finally {
      inflightSync.delete(s);
    }
  })();
  inflightSync.set(s, p);
  return p;
}

// Starts this record's poll/notify/probe loops (no-op if already running).
function activateRecord(rec: DeviceRecord): void {
  if (rec.loops) return;
  const session = rec.session;
  const stopPolling = startPolling(session);
  const stopNotify = startNotifyChannel(session);
  const stopProbe = startLinkProbe(session, rec.id, undefined, { onKilled: ensurePromotedActive });
  rec.loops = () => { stopPolling(); stopNotify(); stopProbe(); };
}

// Shared promotion policy for both session-death paths (transport disconnect
// and the link probe's kill): if the reducer left a dormant record active,
// start its loops and force a full resync (a dormant session can have drifted
// via IR remote / control surfaces / other UART-I2C peers).
function ensurePromotedActive(): void {
  const next = activeRecord();
  if (next && !next.loops) {
    activateRecord(next);
    next.session.mirror.requestReconcile(true);
  }
}

// Stops this record's loops (no new traffic), then drains whatever writes
// were already in flight.
async function deactivateRecord(rec: DeviceRecord): Promise<void> {
  rec.loops?.();
  rec.loops = null;
  await flushAllWrites(rec.session);
}

// Switch protocol: the previously active record goes dormant (loops stopped,
// writes flushed) before the target record takes over; the target's loops
// start only after it is the activated record, then it gets an eager full
// resync via the normal param cadence (dormant sessions can drift via IR
// remote / control surfaces / other UART-I2C peers).
export async function activateSession(id: ConnId): Promise<void> {
  const rec = recordOf(id);
  if (!rec) return;
  const prev = activeRecord();
  if (prev?.id === id) return;
  if (prev) await deactivateRecord(prev);
  dispatch({ t: 'activated', id });
  activateRecord(rec);
  rec.session.mirror.requestReconcile(true);
  // lastSerial now means "which adopted device to activate at boot", so every
  // successful switch -- not just a fresh adoption -- updates it.
  settings.lastSerial = rec.session.info.serial;
}

export async function wireUpConnection(
  device: DspDevice,
  scope?: ConnectionScope,
  id: ConnId = mintConnId(),
  opts?: { activate?: false },
): Promise<void> {
  if (scope?.aborted) return;   // superseded before this attempt started
  dispatch({ t: 'requested', id });
  try {
    const snap = await device.getSnapshot();
    // A newer connection may have begun (and aborted this scope) while
    // getSnapshot() was in flight. Bail without dispatching `synced` or
    // registering this attempt's resources: they'd never be torn down (the
    // abort that would trigger it already fired) and would leak.
    if (scope?.aborted) {
      Log.warn('sync', 'wireUpConnection: superseded connection finished snapshotting; discarding');
      return;
    }
    const session = makeReadySession(device, scope);
    session.mirror.init(snap);
    // Seed the live input-channel count from one status read BEFORE the UI first
    // renders as `ready`. Channel-dependent views (the channel rail, mixer matrix,
    // overview response) treat a null count as "show every possible input", so
    // without this they'd paint full-width and then snap to the real width when
    // the first status poll lands a frame later -- the visible "all channels ->
    // actual config" flash. V10 reports null here, which is correctly "show all"
    // (its true fixed width). Best-effort: on failure the first poll fills it in
    // shortly, i.e. the prior behaviour, so a failed seed never blocks connect.
    try {
      const status = await session.queue.run(() => device.getSystemStatus());
      session.telemetry.activeInputChannels = status.activeInputChannels;
    } catch (err) {
      Log.warn('sync', 'initial status seed failed; first poll will fill it in', err);
    }
    // The status read is an await point: a newer connection may have superseded
    // this one meanwhile. Bail before dispatching `synced` (mirrors the
    // post-getSnapshot guard above) -- scope teardown reclaims the session.
    if (scope?.aborted) return;
    // Captured before the dispatch: adoption makes id active immediately, so
    // this is the only chance to see who was active a moment ago.
    const prev = activeRecord();
    dispatch({ t: 'synced', id, session, activate: opts?.activate });
    const rec = recordOf(id);
    // The loop-stop teardown covers this record's whole life, not just this
    // activation: a record that starts dormant can be activated later via
    // activateSession and die after that, and the scope must still be able to
    // stop its loops then. Tests may call without a scope -- resources
    // register their own abort cleanup directly on the scope rather than
    // through a registry.
    if (rec && scope) scope.onTeardown(() => { rec.loops?.(); rec.loops = null; });
    // The reducer may have activated this record regardless of the caller's
    // intent (nothing else was active) -- gate the active-only side effects
    // on the outcome, not the flag.
    if (activeRecord()?.id === id) {
      if (prev) await deactivateRecord(prev);
      settings.lastSerial = device.info.serial;
      await reconcileAfterSync(session);
      // Re-check after the await: onTeardown self-heals against an
      // already-aborted scope (it fires immediately instead of stranding the
      // resource), so this guard isn't for correctness -- it's to avoid
      // starting the loops and lock only to have them stop on the next tick.
      if (scope?.aborted) return;
      // Re-gate on the outcome too: a concurrent activation can move focus
      // while the deactivate/reconcile awaits are parked, and starting loops
      // here regardless would leave two records live.
      if (rec && activeRecord()?.id === id) activateRecord(rec);
    }
    // Adoption-cycle traffic is allowed even for a record that stays dormant
    // afterward -- it goes quiet once these settle.
    await fetchPresetInfo(session);
    await fetchCtrlIfaceInfo(session);
    await fetchControlSurfaces(session);
    Log.info('sync', 'connected', {
      platform: session.mirror.current?.platform.name,
      wire: device.capabilities.wire,
      masterVolumeDb: session.mirror.current?.masterVolumeDb,
    });
  } catch (err) {
    Log.error('sync', 'wireUpConnection failed', err);
    // A stale failure from a superseded attempt must not clobber whatever the
    // newer connection has already put in app state.
    if (!scope?.aborted) dispatch({ t: 'failed', id, message: errMessage(err) });
    throw err;
  }
}

// Reconcile UI policy after (re)connect. reconcileSelectedChannel validates the
// persisted selection against the connected platform's channel set and its
// visibility (disabled outputs, live input count).
export async function reconcileAfterSync(s: ReadySession): Promise<void> {
  const snap = s.mirror.current;
  reconcileSelectedChannel(snap?.channels, selectionVisibilityOf(snap?.outputs ?? [], s.telemetry.activeInputChannels));
}

export function attachTransportListeners(transport: DspTransport, id: ConnId, scope: ConnectionScope): () => void {
  const offDisc = transport.on('disconnect', () => {
    // Dispatch first: the removal must land while this connection's record
    // still exists. scope.abort() tears down the session (dispose is an
    // abort listener) and this very listener in one shot -- deleting the
    // currently-firing entry from the transport's listener Set during its
    // forEach is safe, it won't be revisited and won't throw. Removal is
    // scoped to THIS connection id: an unrelated dormant connection's device
    // is untouched.
    dispatch({ t: 'removed', id });
    scope.abort();
    ensurePromotedActive();
  });
  return () => { offDisc(); };
}

export async function factoryResetDevice(): Promise<void> {
  const s = activeSession();
  if (!s) return;
  const d = s.device;
  try {
    // Drain any parked optimistic write so a pre-reset bulk send can't settle
    // mid-reset and re-push stale params (mirrors the preset load/paste flows).
    await flushAllWrites(s);
    const r = await s.queue.run(() => d.factoryReset());
    if (!r.ok) { pushNotice('warn', r.message); return; }  // non-ok flash status
    invalidatePresetCache(s);
    s.copySource.held = null;
    await syncDeviceSnapshot(s);
    pushNotice('info', 'Factory reset complete.');
  } catch (e) {
    Log.error('action', 'factory reset failed', e);
    pushNotice('error', 'Factory reset failed');
  }
}
