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
import { flushAllWrites } from './writes';
import { startPolling } from './poll';
import { startNotifyChannel } from './notifyChannel';
import { startLinkProbe } from './linkProbe';
import { endConnection, type ConnectionScope } from './connectionScope';
import { acquireDeviceLock, releaseDeviceLock } from './deviceLock';
import { fetchPresetInfo, invalidatePresetCache } from './presets';

let inflightSync: Promise<void> | null = null;

export async function syncDeviceSnapshot(s: ReadySession): Promise<void> {
  if (inflightSync) return inflightSync;
  const d = s.device;
  inflightSync = (async () => {
    try {
      const snap = await d.getSnapshot();
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
  const attempt = scope?.attempt;
  dispatch({ t: 'requested', attempt });
  try {
    const snap = await device.getSnapshot();
    const session = makeReadySession(device, attempt ?? 0);
    dispatch({ t: 'synced', session, attempt });
    session.mirror.init(snap);
    settings.lastSerial = device.info.serial;
    await reconcileAfterSync(session);
    // Registration targets the attempt's own scope (never the ambient active
    // one) so a concurrent attempt can't adopt this session's machinery.
    // Tests may call without a scope.
    if (scope) {
      scope.add(startPolling(session));
      scope.add(startNotifyChannel(session));
      scope.add(startLinkProbe(session));
      acquireDeviceLock();
      scope.add(() => releaseDeviceLock());
    }
    await fetchPresetInfo(session);
    Log.info('sync', 'connected', {
      platform: session.mirror.current?.platform.name,
      wire: device.capabilities.wire,
      masterVolumeDb: session.mirror.current?.masterVolumeDb,
    });
  } catch (err) {
    Log.error('sync', 'wireUpConnection failed', err);
    dispatch({ t: 'failed', message: errMessage(err), attempt });
    throw err;
  }
}

// Reconcile UI policy after (re)connect. reconcileSelectedChannel validates the
// persisted selection against the connected platform's channel set.
export async function reconcileAfterSync(s: ReadySession): Promise<void> {
  reconcileSelectedChannel(s.mirror.current?.channels);
}

export function attachTransportListeners(transport: DspTransport, _device: DspDevice, attempt?: number): () => void {
  const offDisc = transport.on('disconnect', () => {
    // Dispatch first: endConnection() clears the attempt token, which would
    // drop this very event. Deleting the currently-firing entry from the
    // transport's listener Set during its forEach is safe -- it won't be
    // revisited and won't throw.
    const outgoing = activeSession();
    dispatch({ t: 'disconnected', attempt });
    endConnection();                 // disposes resync, poll loop, listeners
    outgoing?.dispose();             // alive=false + cancel this session's write lanes
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
    const r = await d.factoryReset();
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
