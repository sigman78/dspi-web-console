// Connection & whole-device service operations, split out from actions.ts
// (which holds the granular per-parameter verbs). Everything here touches the
// whole session or the whole snapshot: connect/sync/reconcile, transport-event
// wiring, and the factory-reset command — as opposed to a single mirror field.

import type { DspTransport } from '@/transport/DspTransport';
import type { DspDevice } from '@/device/DspDevice';
import {
  settings, reconcileEqTarget,
  pushNotice,
  dispatch, makeReadySession, activeSession,
} from '@/state';
import { Log } from '@/utils';
import { flushAllWrites } from './writes';
import { startPolling } from './poll';
import { startNotifyChannel } from './notifyChannel';
import { connectionScope, endConnection } from './connectionScope';
import { acquireDeviceLock, releaseDeviceLock } from './deviceLock';
import { fetchPresetInfo, invalidatePresetCache } from './presets';
import { MUTE_DB } from '@/domain/clamp';

let inflightSync: Promise<void> | null = null;

export async function syncDeviceSnapshot(): Promise<void> {
  if (inflightSync) return inflightSync;
  const s = activeSession();
  if (!s) throw new Error('No device');
  const d = s.device;
  inflightSync = (async () => {
    try {
      const snap = await d.getSnapshot();
      s.mirror.init(snap);
    } catch (err) {
      Log.error('sync', 'syncDeviceSnapshot failed', err);
      dispatch({ t: 'failed', message: (err as Error).message });
      throw err;
    } finally {
      inflightSync = null;
    }
  })();
  return inflightSync;
}

export async function wireUpConnection(device: DspDevice): Promise<void> {
  dispatch({ t: 'requested' });
  try {
    const snap = await device.getSnapshot();
    const session = makeReadySession(device);
    dispatch({ t: 'synced', session });
    session.mirror.init(snap);
    settings.lastSerial = device.info.serial;
    await reconcileAfterSync();
    // Production opens the scope in createBoundDevice; tests may call
    // wireUpConnection directly with no scope, so guard the registration.
    const scope = connectionScope();
    if (scope) {
      scope.add(startPolling(session));
      scope.add(startNotifyChannel(session));
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
    dispatch({ t: 'failed', message: (err as Error).message });
    throw err;
  }
}

// Re-apply UI policy that should outlive a (re)connect (mute, eqTarget).
// Runs after the snapshot is hydrated and the connection is marked
// connected, so it sees the freshly-synced device state and can write
// through it. reconcileEqTarget is a pure state-layer step that runs
// before the device-touching mute restore -- it doesn't need the device.
export async function reconcileAfterSync(): Promise<void> {
  reconcileEqTarget();
  const s = activeSession();
  if (!s) return;
  const d = s.device;
  if (settings.soft.muted) {
    const restoreFrom = settings.soft.mutedFromDb ?? s.mirror.current?.masterVolumeDb ?? 0;
    settings.soft.mutedFromDb = restoreFrom;
    if (s.mirror.current) s.mirror.current.masterVolumeDb = MUTE_DB;
    await d.setMasterVolume(MUTE_DB);
  }
}

export function attachTransportListeners(transport: DspTransport, device: DspDevice): () => void {
  const offDisc = transport.on('disconnect', () => {
    // endConnection() disposes the scope, which removes THIS very listener
    // mid-emit (offDisc). Deleting the currently-firing entry from the
    // transport's listener Set during its forEach is safe — it won't be
    // revisited and won't throw.
    const outgoing = activeSession();
    endConnection();                 // disposes resync, poll loop, listeners
    dispatch({ t: 'disconnected' });
    outgoing?.dispose();             // alive=false + cancel this session's write lanes
    // Per-session stores die with the disposed session; the next connect builds
    // fresh ones via makeReadySession, so there is nothing to reset here.
  });
  const offConn = transport.on('connect', () => {
    void wireUpConnection(device).catch((e) => {
      Log.error('transport', 'auto-finish after connect failed', e);
      dispatch({ t: 'failed', message: (e as Error).message });
    });
  });
  return () => { offDisc(); offConn(); };
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
    s.copySource.slot = null;
    await syncDeviceSnapshot();
    pushNotice('info', 'Factory reset complete.');
  } catch (e) {
    Log.error('action', 'factory reset failed', e);
    pushNotice('error', 'Factory reset failed');
  }
}
