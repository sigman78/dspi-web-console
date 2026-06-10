import { DspDevice, UnsupportedFirmware, UnsupportedDevicePacket } from '@/device/DspDevice';
import type { DspTransport } from '@/transport/DspTransport';
import { MockTransport } from '@/transport/MockTransport';
import { matchesDspi, WebUsbTransport } from '@/transport/WebUsbTransport';
import { withTimeout } from '@/transport/withTimeout';
import { withWireMonitor } from '@/transport/withWireMonitor';
import { formatDeviceInfo, wireMonitorEnabled } from '@/protocol/wireMonitor';
import { attachTransportListeners, wireUpConnection } from './deviceService';
import { beginConnection, endConnection, type ConnectionScope } from './connectionScope';
import { isDeviceHeld } from './deviceLock';
import { settings, dispatch, connection } from '@/state';
import { Log } from '@/utils';

// Per-call ceiling on USB control transfers. Without it, a frozen firmware leaves
// the mutation coalescer waiting forever on a dead promise and the next
// schedule() queues behind it. 2 s absorbs USB hub jitter on Windows yet surfaces
// a hung transfer as an error within one human breath.
const CTRL_TIMEOUT_MS = 2000;

let booting = false;

export function webUsbUnsupportedReason(): string | null {
  return WebUsbTransport.unsupportedReason();
}

// Maps a connect failure onto session status. UnsupportedFirmware gets a
// distinct kind so the hero shows an upgrade prompt instead of the generic
// diagnostics panel. `attempt` scopes the dispatch to the failing attempt so a
// stale failure can't clobber a newer connection's state.
export function reportConnectError(err: unknown, attempt?: number): void {
  const message = (err as Error)?.message ?? String(err);
  const upgrade = err instanceof UnsupportedFirmware || err instanceof UnsupportedDevicePacket;
  dispatch({ t: 'failed', message, errorKind: upgrade ? 'unsupported-firmware' : null, attempt });
}

async function createBoundDevice(
  transport: DspTransport,
  scope: ConnectionScope,
  openTransport?: () => Promise<void>,
): Promise<DspDevice> {
  // Wrap with the timeout decorator before DspDevice so every ctrlIn/ctrlOut
  // inherits the deadline. The wire monitor (gated on ?debug) sits inside the
  // timeout wrapper so its formatting is off the timeout-race path.
  // attachTransportListeners + close target the raw transport, since
  // connect/disconnect events come from there, not the wrappers.
  const monitored = wireMonitorEnabled() ? withWireMonitor(transport) : transport;
  const wrapped = withTimeout(monitored, { ctrlMs: CTRL_TIMEOUT_MS });
  try {
    const device = await DspDevice.create(wrapped, openTransport);
    scope.add(attachTransportListeners(transport, device, scope.attempt));
    if (wireMonitorEnabled()) {
      // Connection banner (info level). A debug banner must never break a real
      // connection, so swallow any logging failure.
      try {
        for (const line of formatDeviceInfo(device.info)) Log.info('wire', line);
      } catch { /* ignore */ }
    }
    return device;
  } catch (err) {
    try {
      await transport.close();
    } catch (closeErr) {
      Log.error('connect', 'cleanup close after failed init failed', closeErr);
    }
    throw err;
  }
}

// Entry points own the attempt: mint the scope, report failure with its token
// BEFORE endConnection() clears it (a cleared token would drop the dispatch and
// strand the UI in 'connecting').

export async function connectRequested(): Promise<void> {
  if (connection.phase === 'connecting') return;
  const scope = beginConnection();
  try {
    dispatch({ t: 'requested', attempt: scope.attempt });
    const transport = new WebUsbTransport();
    const device = await createBoundDevice(transport, scope, () => transport.requestAndOpen());
    await wireUpConnection(device, scope);
  } catch (err) {
    Log.error('connect', 'connect failed', err);
    reportConnectError(err, scope.attempt);
    endConnection();
    throw err;
  }
}

export async function bootMock(platform: 'rp2040' | 'rp2350'): Promise<void> {
  const scope = beginConnection();
  try {
    const transport = new MockTransport({ platform });
    const device = await createBoundDevice(transport, scope, undefined);
    await wireUpConnection(device, scope);
  } catch (err) {
    reportConnectError(err, scope.attempt);
    endConnection();
    throw err;
  }
}

export async function bootReal(): Promise<void> {
  if (booting) return;
  booting = true;
  try {
    // Another tab in this browser already holds the device. Auto-claiming would
    // throw a raw "unable to claim interface" error and clobber the hero with a
    // diagnostics panel; skip it so the "DEVICE IN USE" advisory shows instead.
    // (The desktop app / another browser can't be detected this way and still
    // falls back to the claim-failure text.)
    if (await isDeviceHeld()) return;
    const transport = new WebUsbTransport();
    const ok = await transport.tryAutoConnect();
    if (!ok) return;
    const scope = beginConnection();
    try {
      const device = await createBoundDevice(transport, scope, async () => {});
      await wireUpConnection(device, scope);
    } catch (err) {
      reportConnectError(err, scope.attempt);
      endConnection();
      throw err;
    }
  } finally {
    booting = false;
  }
}

export function registerNavigatorReconnect(): void {
  if (typeof navigator === 'undefined' || !('usb' in navigator)) return;
  navigator.usb.addEventListener('connect', (event: USBConnectionEvent) => {
    const target = settings.lastSerial;
    if (!target) return;
    if (!matchesDspi(event.device)) return;
    if (event.device.serialNumber !== target) return;
    if (booting) return;
    if (connection.connected || connection.phase === 'connecting') return;
    Log.info('reconnect', 'last-known device re-enumerated, attempting bootReal()');
    // bootReal reports failures itself with its own attempt token.
    void bootReal().catch((e) => Log.error('reconnect', 'auto-reconnect failed', e));
  });
}
