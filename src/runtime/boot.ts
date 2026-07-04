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
import { Log, errMessage } from '@/utils';

// Per-call ceiling on USB control transfers. Without it, a frozen firmware leaves
// the mutation coalescer waiting forever on a dead promise and the next
// schedule() queues behind it. 2 s absorbs USB hub jitter on Windows yet surfaces
// a hung transfer as an error within one human breath.
const CTRL_TIMEOUT_MS = 2000;

let inflightBoot: Promise<void> | null = null;

export function webUsbUnsupportedReason(): string | null {
  return WebUsbTransport.unsupportedReason();
}

// Maps a connect failure onto session status. UnsupportedFirmware gets a
// distinct kind so the hero shows an upgrade prompt instead of the generic
// diagnostics panel.
export function reportConnectError(err: unknown): void {
  const message = errMessage(err);
  const upgrade = err instanceof UnsupportedFirmware || err instanceof UnsupportedDevicePacket;
  dispatch({ t: 'failed', message, errorKind: upgrade ? 'unsupported-firmware' : null });
}

async function createBoundDevice(
  transport: DspTransport,
  controller: AbortController,
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
    controller.signal.addEventListener('abort', attachTransportListeners(transport, device), { once: true });
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

// Entry points own the connection: mint the controller, and on failure only
// report/endConnection if this attempt hasn't already been superseded by a
// newer one. A newer beginConnection() call aborts this controller and
// re-points the active connection at its own controller, so calling
// endConnection() here in that case would tear down the newer connection
// instead of this dead one.

export async function connectRequested(): Promise<void> {
  if (connection.phase === 'connecting') return;
  const controller = beginConnection();
  try {
    dispatch({ t: 'requested' });
    const transport = new WebUsbTransport();
    const device = await createBoundDevice(transport, controller, () => transport.requestAndOpen());
    await wireUpConnection(device, controller);
  } catch (err) {
    Log.error('connect', 'connect failed', err);
    if (!controller.signal.aborted) {
      reportConnectError(err);
      endConnection();
    }
    throw err;
  }
}

export async function bootMock(platform: 'rp2040' | 'rp2350', opts: { wireVersion?: number } = {}): Promise<void> {
  const controller = beginConnection();
  try {
    const transport = new MockTransport({ platform, ...opts });
    const device = await createBoundDevice(transport, controller, undefined);
    await wireUpConnection(device, controller);
  } catch (err) {
    if (!controller.signal.aborted) {
      reportConnectError(err);
      endConnection();
    }
    throw err;
  }
}

export async function bootReal(): Promise<void> {
  if (inflightBoot) return inflightBoot;
  inflightBoot = (async () => {
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
      const controller = beginConnection();
      try {
        const device = await createBoundDevice(transport, controller, async () => {});
        await wireUpConnection(device, controller);
      } catch (err) {
        if (!controller.signal.aborted) {
          reportConnectError(err);
          endConnection();
        }
        throw err;
      }
    } finally {
      inflightBoot = null;
    }
  })();
  return inflightBoot;
}

export function registerNavigatorReconnect(): void {
  if (typeof navigator === 'undefined' || !('usb' in navigator)) return;
  navigator.usb.addEventListener('connect', (event: USBConnectionEvent) => {
    const target = settings.lastSerial;
    if (!target) return;
    if (!matchesDspi(event.device)) return;
    if (event.device.serialNumber !== target) return;
    if (inflightBoot) return;
    if (connection.connected || connection.phase === 'connecting') return;
    Log.info('reconnect', 'last-known device re-enumerated, attempting bootReal()');
    // bootReal reports failures itself, guarded against a superseded attempt.
    void bootReal().catch((e) => Log.error('reconnect', 'auto-reconnect failed', e));
  });
}
