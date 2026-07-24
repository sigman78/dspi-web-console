import { DspDevice, UnsupportedFirmware, UnsupportedDevicePacket } from '@/device/DspDevice';
import type { DspTransport } from '@/transport/DspTransport';
import { MockTransport, type MockOptions } from '@/transport/MockTransport';
import { matchesDspi, WebUsbTransport, DeviceInUse } from '@/transport/WebUsbTransport';
import { withTimeout } from '@/transport/withTimeout';
import { withWireMonitor } from '@/transport/withWireMonitor';
import { formatDeviceInfo, wireMonitorEnabled } from '@/protocol/wireMonitor';
import { attachTransportListeners, wireUpConnection } from './deviceService';
import { ConnectionScope } from './connectionScope';
import { settings, dispatch, connection, mintConnId, type ConnId, type SessionErrorKind } from '@/state';
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

// Maps a connect failure onto session status. Certain failures get a distinct
// kind so the hero can tailor its advice: UnsupportedFirmware -> upgrade prompt,
// DeviceInUse (interface claim failed) -> "device in use" causes. Everything else
// falls through to the generic diagnostics panel.
export function reportConnectError(id: ConnId, err: unknown): void {
  const message = errMessage(err);
  let errorKind: SessionErrorKind = null;
  if (err instanceof UnsupportedFirmware || err instanceof UnsupportedDevicePacket) {
    errorKind = 'unsupported-firmware';
  } else if (err instanceof DeviceInUse) {
    errorKind = 'device-in-use';
  }
  dispatch({ t: 'failed', id, message, errorKind });
}

async function createBoundDevice(
  transport: DspTransport,
  scope: ConnectionScope,
  id: ConnId,
  openTransport?: () => Promise<void>,
): Promise<DspDevice> {
  // Wrap with the timeout decorator before DspDevice so every ctrlIn/ctrlOut
  // inherits the deadline. The wire monitor (gated on ?log=wire) sits inside the
  // timeout wrapper so its formatting is off the timeout-race path.
  // attachTransportListeners + close target the raw transport, since
  // connect/disconnect events come from there, not the wrappers.
  const monitored = wireMonitorEnabled() ? withWireMonitor(transport) : transport;
  const wrapped = withTimeout(monitored, { ctrlMs: CTRL_TIMEOUT_MS });
  try {
    const device = await DspDevice.create(wrapped, openTransport);
    scope.onTeardown(attachTransportListeners(transport, id, scope));
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

// Entry points own the connection: mint an id and a private scope, and on
// failure only report/abort if this attempt hasn't already been superseded by
// a newer one -- a newer connect aborts this scope directly (it never shares
// state with the newer attempt's own scope), so an abort here always targets
// the right connection.

export async function connectRequested(): Promise<void> {
  if (connection.phase === 'connecting') return;
  const id = mintConnId();
  const scope = new ConnectionScope();
  try {
    dispatch({ t: 'requested', id });
    const transport = new WebUsbTransport();
    const device = await createBoundDevice(transport, scope, id, () => transport.requestAndOpen());
    await wireUpConnection(device, scope, id);
  } catch (err) {
    Log.error('connect', 'connect failed', err);
    if (!scope.aborted) {
      reportConnectError(id, err);
      scope.abort();
    }
    throw err;
  }
}

export async function bootMock(
  platform: 'rp2040' | 'rp2350',
  opts: Omit<MockOptions, 'platform'> = {},
): Promise<void> {
  const id = mintConnId();
  const scope = new ConnectionScope();
  try {
    const transport = new MockTransport({ platform, ...opts });
    const device = await createBoundDevice(transport, scope, id, undefined);
    await wireUpConnection(device, scope, id);
  } catch (err) {
    if (!scope.aborted) {
      reportConnectError(id, err);
      scope.abort();
    }
    throw err;
  }
}

export async function bootReal(): Promise<void> {
  if (inflightBoot) return inflightBoot;
  inflightBoot = (async () => {
    try {
      const transport = new WebUsbTransport();
      const ok = await transport.tryAutoConnect();
      if (!ok) return;
      const id = mintConnId();
      const scope = new ConnectionScope();
      try {
        const device = await createBoundDevice(transport, scope, id, async () => {});
        await wireUpConnection(device, scope, id);
      } catch (err) {
        if (!scope.aborted) {
          reportConnectError(id, err);
          scope.abort();
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
