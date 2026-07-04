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
import { flushAllWrites } from './writes.svelte';
import { startPolling } from './poll';
import { startNotifyChannel } from './notifyChannel';
import { startLinkProbe } from './linkProbe';
import { endConnection } from './connectionScope';
import { acquireDeviceLock, releaseDeviceLock } from './deviceLock';
import { fetchPresetInfo, invalidatePresetCache } from './presets';

let inflightSync: Promise<void> | null = null;

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

export async function wireUpConnection(device: DspDevice, controller?: AbortController): Promise<void> {
  if (controller?.signal.aborted) return;   // superseded before this attempt started
  dispatch({ t: 'requested' });
  try {
    const snap = await device.getSnapshot();
    // A newer connection may have begun (and aborted this controller) while
    // getSnapshot() was in flight. Bail without dispatching `synced` or
    // registering this attempt's resources: they'd never be torn down (the
    // abort that would trigger it already fired) and would leak.
    if (controller?.signal.aborted) {
      Log.warn('sync', 'wireUpConnection: superseded connection finished snapshotting; discarding');
      return;
    }
    const session = makeReadySession(device, controller);
    dispatch({ t: 'synced', session });
    session.mirror.init(snap);
    settings.lastSerial = device.info.serial;
    await reconcileAfterSync(session);
    // Re-check after the await: an abort-listener registered on an
    // already-aborted signal never fires, so registering below would strand
    // the loops and the device lock with no teardown path.
    if (controller?.signal.aborted) return;
    // Tests may call without a controller. Resources register their own
    // abort cleanup directly on the signal rather than through a registry.
    if (controller) {
      controller.signal.addEventListener('abort', startPolling(session), { once: true });
      controller.signal.addEventListener('abort', startNotifyChannel(session), { once: true });
      controller.signal.addEventListener('abort', startLinkProbe(session), { once: true });
      acquireDeviceLock();
      controller.signal.addEventListener('abort', () => releaseDeviceLock(), { once: true });
    }
    await fetchPresetInfo(session);
    Log.info('sync', 'connected', {
      platform: session.mirror.current?.platform.name,
      wire: device.capabilities.wire,
      masterVolumeDb: session.mirror.current?.masterVolumeDb,
    });
  } catch (err) {
    Log.error('sync', 'wireUpConnection failed', err);
    // A stale failure from a superseded attempt must not clobber whatever the
    // newer connection has already put in app state.
    if (!controller?.signal.aborted) dispatch({ t: 'failed', message: errMessage(err) });
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
