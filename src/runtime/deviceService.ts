// Connection & whole-device service operations, split out from actions.ts
// (which holds the granular per-parameter verbs). Everything here touches the
// whole session or the whole snapshot: connect/sync/reconcile, transport-event
// wiring, and the factory-reset command -- as opposed to a single mirror field.

import type { DspTransport } from '@/transport/DspTransport';
import type { DspDevice } from '@/device/DspDevice';
import {
  settings, reconcileSelectedChannel,
  pushNotice,
  dispatch, makeReadySession, activeSession,
  type ReadySession,
} from '@/state';
import { Log, errMessage } from '@/utils';
import * as Domain from '@/domain';
import { flushAllWrites } from './writes.svelte';
import { startPolling } from './poll';
import { startNotifyChannel } from './notifyChannel';
import { startLinkProbe } from './linkProbe';
import { endConnection, type ConnectionScope } from './connectionScope';
import { fetchPresetInfo, invalidatePresetCache } from './presets';

let inflightSync: Promise<void> | null = null;

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

// Control Surfaces mirror of fetchCtrlIfaceInfo: caps (host order: header,
// then per-noun descriptors -- DspDevice owns that loop), live status, then
// every slot's binding. Idempotent once caps are populated; never throws.
export async function fetchControlSurfaces(s: ReadySession): Promise<void> {
  if (!s.device.capabilities.features.controlSurfaces) return;
  if (s.controlSurfaces.caps != null) return;
  const d = s.device;
  s.controlSurfaces.busy = true;
  try {
    const { caps, nouns } = await s.queue.run(() => d.getCsCaps());
    const status = await s.queue.run(() => d.getCsStatus());
    const bindings: (Domain.CsBinding | null)[] = [];
    for (let slot = 0; slot < caps.maxBindings; slot++) {
      const b = await s.queue.run(() => d.getCsBinding(slot));
      bindings.push(b.type === Domain.CsType.None ? null : b);
    }
    s.controlSurfaces.caps = caps;
    s.controlSurfaces.nouns = nouns;
    s.controlSurfaces.status = status;
    s.controlSurfaces.bindings = bindings;
    s.controlSurfaces.lastFetchError = null;
  } catch (err) {
    s.controlSurfaces.lastFetchError = errMessage(err);
    Log.warn('controlSurfaces', 'fetch failed', err);
  } finally {
    s.controlSurfaces.busy = false;
  }
}

export async function syncDeviceSnapshot(s: ReadySession): Promise<void> {
  if (inflightSync) return inflightSync;
  const d = s.device;
  inflightSync = (async () => {
    try {
      const snap = await s.queue.run(() => d.getSnapshot());
      s.mirror.init(snap);
    } catch (err) {
      Log.error('sync', 'syncDeviceSnapshot failed', err);
      s.health.noteFail('sync', err);
      throw err;
    } finally {
      inflightSync = null;
    }
  })();
  return inflightSync;
}

export async function wireUpConnection(device: DspDevice, scope?: ConnectionScope): Promise<void> {
  if (scope?.aborted) return;   // superseded before this attempt started
  dispatch({ t: 'requested' });
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
    dispatch({ t: 'synced', session });
    settings.lastSerial = device.info.serial;
    await reconcileAfterSync(session);
    // Re-check after the await: onTeardown self-heals against an
    // already-aborted scope (it fires immediately instead of stranding the
    // resource), so this guard isn't for correctness -- it's to avoid
    // starting the loops and lock only to have them stop on the next tick.
    if (scope?.aborted) return;
    // Tests may call without a scope. Resources register their own abort
    // cleanup directly on the scope rather than through a registry.
    if (scope) {
      scope.onTeardown(startPolling(session));
      scope.onTeardown(startNotifyChannel(session));
      scope.onTeardown(startLinkProbe(session));
    }
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
    if (!scope?.aborted) dispatch({ t: 'failed', message: errMessage(err) });
    throw err;
  }
}

// Reconcile UI policy after (re)connect. reconcileSelectedChannel validates the
// persisted selection against the connected platform's channel set.
export async function reconcileAfterSync(s: ReadySession): Promise<void> {
  reconcileSelectedChannel(s.mirror.current?.channels);
}

export function attachTransportListeners(transport: DspTransport, _device: DspDevice): () => void {
  const offDisc = transport.on('disconnect', () => {
    // Dispatch first: the disconnected transition must land while this is
    // still the active connection. endConnection() aborts the controller,
    // which tears down the session (dispose is an abort listener) and this
    // very listener in one shot -- deleting the currently-firing entry from
    // the transport's listener Set during its forEach is safe, it won't be
    // revisited and won't throw.
    dispatch({ t: 'disconnected' });
    endConnection();
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
