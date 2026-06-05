import { DspDevice, UnsupportedFirmware, UnsupportedDevicePacket } from '@/device/DspDevice';
import type { DspTransport } from '@/transport/DspTransport';
import { MockTransport } from '@/transport/MockTransport';
import { matchesDspi, WebUsbTransport } from '@/transport/WebUsbTransport';
import { withTimeout } from '@/transport/withTimeout';
import { withWireMonitor } from '@/transport/withWireMonitor';
import { formatDeviceInfo, wireMonitorEnabled } from '@/protocol/wireMonitor';
import { attachTransportListeners, wireUpConnection } from './deviceService';
import { beginConnection, endConnection } from './connectionScope';
import { isDeviceHeld } from './deviceLock';
import { settings, dispatch, connection } from '@/state';
import { Log } from '@/utils';

// Per-call ceiling on USB control transfers. A frozen firmware would
// otherwise leave the mutation coalescer waiting forever on a dead
// promise; the next schedule() would queue behind it. 2 s is long enough
// to absorb USB hub jitter on Windows and short enough that a hung
// control transfer becomes visible as an error within one human breath.
const CTRL_TIMEOUT_MS = 2000;

let booting = false;

export function webUsbUnsupportedReason(): string | null {
  return WebUsbTransport.unsupportedReason();
}

// Maps a connect failure onto session status. UnsupportedFirmware gets a
// distinct kind so the hero shows an upgrade prompt instead of the generic
// diagnostics panel.
export function reportConnectError(err: unknown): void {
  const message = (err as Error)?.message ?? String(err);
  const upgrade = err instanceof UnsupportedFirmware || err instanceof UnsupportedDevicePacket;
  dispatch({ t: 'failed', message, errorKind: upgrade ? 'unsupported-firmware' : null });
}

async function createBoundDevice(
  transport: DspTransport,
  openTransport?: () => Promise<void>,
): Promise<DspDevice> {
  // Wrap with the timeout decorator before handing to DspDevice so every
  // ctrlIn/ctrlOut inherits the deadline. attachTransportListeners stays
  // on the underlying transport -- connect/disconnect events come from the
  // real transport, not from the timeout wrapper.
  // The wire monitor (gated on ?debug) sits inside the timeout wrapper so it
  // logs the real bytes/response and its formatting is off the timeout-race
  // path. attachTransportListeners + close still target the raw transport.
  const monitored = wireMonitorEnabled() ? withWireMonitor(transport) : transport;
  const wrapped = withTimeout(monitored, { ctrlMs: CTRL_TIMEOUT_MS });
  const scope = beginConnection();                   // fresh scope (disposes any prior)
  try {
    const device = await DspDevice.create(wrapped, openTransport);
    scope.add(attachTransportListeners(transport, device));
    if (wireMonitorEnabled()) {
      // Connection banner (info level). A debug banner must never break a real
      // connection, so swallow any logging failure.
      try {
        for (const line of formatDeviceInfo(device.info)) Log.info('wire', line);
      } catch { /* ignore */ }
    }
    return device;
  } catch (err) {
    endConnection();                                 // dispose the partial scope
    try {
      await transport.close();
    } catch (closeErr) {
      Log.error('connect', 'cleanup close after failed init failed', closeErr);
    }
    throw err;
  }
}

export async function connectRequested(): Promise<void> {
  try {
    dispatch({ t: 'requested' });
    const transport = new WebUsbTransport();
    const device = await createBoundDevice(transport, () => transport.requestAndOpen());
    await wireUpConnection(device);
  } catch (err) {
    Log.error('connect', 'connect failed', err);
    reportConnectError(err);
    throw err;
  }
}

export async function bootMock(platform: 'rp2040' | 'rp2350'): Promise<void> {
  const transport = new MockTransport({ platform });
  const device = await createBoundDevice(transport, undefined);
  await wireUpConnection(device);
}

export async function bootReal(): Promise<void> {
  if (booting) return;
  booting = true;
  try {
    // Another tab in this browser already holds the device. Auto-claiming here
    // would throw a raw "unable to claim interface" error and clobber the hero
    // with a diagnostics panel; skip the attempt so the "DEVICE IN USE" advisory
    // shows instead. (The desktop app / another browser can't be detected this
    // way and still falls back to the claim-failure text.)
    if (await isDeviceHeld()) return;
    const transport = new WebUsbTransport();
    const ok = await transport.tryAutoConnect();
    if (!ok) return;
    const device = await createBoundDevice(transport, async () => {});
    await wireUpConnection(device);
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
    void bootReal().catch(reportConnectError);
  });
}
