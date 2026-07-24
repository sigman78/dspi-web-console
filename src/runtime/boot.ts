import { DspDevice, UnsupportedFirmware, UnsupportedDevicePacket } from '@/device/DspDevice';
import type { DspTransport } from '@/transport/DspTransport';
import { MockTransport, type MockOptions } from '@/transport/MockTransport';
import { matchesDspi, WebUsbTransport, DeviceInUse } from '@/transport/WebUsbTransport';
import { withTimeout } from '@/transport/withTimeout';
import { withWireMonitor } from '@/transport/withWireMonitor';
import { formatDeviceInfo, wireMonitorEnabled } from '@/protocol/wireMonitor';
import { attachTransportListeners, wireUpConnection, activateSession } from './deviceService';
import { ConnectionScope } from './connectionScope';
import {
  settings, dispatch, mintConnId, activeRecord, recordBySerial, adoptionInProgress,
  type ConnId, type SessionErrorKind,
} from '@/state';
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
  if (adoptionInProgress() || inflightBoot) return;
  const id = mintConnId();
  const scope = new ConnectionScope();
  try {
    dispatch({ t: 'requested', id });
    const transport = new WebUsbTransport();
    const picked = await transport.requestDevice();
    const existing = picked.serialNumber ? recordBySerial(picked.serialNumber) : null;
    if (existing) {
      // We already hold this device's session -- switch to it instead of
      // claiming its interface a second time. This attempt never got past the
      // picker, so drop it back to idle rather than leaving it stuck
      // 'connecting'.
      dispatch({ t: 'removed', id });
      scope.abort();
      await activateSession(existing.id);
      return;
    }
    const device = await createBoundDevice(transport, scope, id, () => transport.open());
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
  connectOpts?: { activate?: false },
): Promise<void> {
  const id = mintConnId();
  const scope = new ConnectionScope();
  try {
    const transport = new MockTransport({ platform, ...opts });
    const device = await createBoundDevice(transport, scope, id, undefined);
    await wireUpConnection(device, scope, id, connectOpts);
  } catch (err) {
    if (!scope.aborted) {
      reportConnectError(id, err);
      scope.abort();
    }
    throw err;
  }
}

// Adopts every granted device sequentially: the first becomes active (default
// activation), the rest register dormant (unless the loop leaves nothing
// active, in which case the reducer activates the next one anyway). A
// per-device failure is logged and skipped -- a partial fleet must not paint
// the error hero over a device that did come up; the hero only appears if the
// whole loop adopts zero sessions, reusing the last failure's id/error so
// reportConnectError can still classify it (unsupported firmware, in-use, ...).
async function adoptGrantedDevices(granted: readonly USBDevice[]): Promise<void> {
  // Captured before adopting: the first device's own adoption already
  // overwrites settings.lastSerial (it becomes active by default), so reading
  // it after the loop would always name whichever device came up first.
  const wantSerial = settings.lastSerial;
  let adopted = 0;
  let lastFailure: { id: ConnId; err: unknown } | null = null;
  for (const [i, usbDevice] of granted.entries()) {
    const id = mintConnId();
    const scope = new ConnectionScope();
    try {
      const transport = new WebUsbTransport(usbDevice);
      const device = await createBoundDevice(transport, scope, id, () => transport.open());
      await wireUpConnection(device, scope, id, i === 0 ? undefined : { activate: false });
      adopted += 1;
    } catch (err) {
      Log.error('connect', 'boot adoption failed', err);
      scope.abort();
      lastFailure = { id, err };
    }
  }
  if (adopted === 0 && lastFailure) reportConnectError(lastFailure.id, lastFailure.err);
  const target = wantSerial ? recordBySerial(wantSerial) : null;
  if (target && activeRecord()?.id !== target.id) await activateSession(target.id);
}

export async function bootReal(): Promise<void> {
  if (inflightBoot) return inflightBoot;
  inflightBoot = (async () => {
    try {
      if (!WebUsbTransport.isSupported()) return;
      const granted = (await navigator.usb.getDevices()).filter(matchesDspi);
      if (granted.length === 0) return;
      await adoptGrantedDevices(granted);
    } finally {
      inflightBoot = null;
    }
  })();
  return inflightBoot;
}

// The 'connect' event only fires for devices this origin already holds a
// permission grant for, so the grant IS the policy -- any granted DSPi gets
// adopted, not just settings.lastSerial. Adoption always requests
// `activate: false`: the reducer activates it only if nothing else is active,
// so a live device never loses focus to a background replug.
async function adoptReconnectedDevice(usbDevice: USBDevice): Promise<void> {
  const id = mintConnId();
  const scope = new ConnectionScope();
  try {
    const transport = new WebUsbTransport(usbDevice);
    const device = await createBoundDevice(transport, scope, id, () => transport.open());
    await wireUpConnection(device, scope, id, { activate: false });
  } catch (err) {
    if (!scope.aborted) scope.abort();
    // With nothing else live, wireUpConnection's own failed dispatch has
    // already painted the hero -- unclassified. Re-report so the tailored
    // advice (device in use, unsupported firmware) isn't lost on this path.
    if (activeRecord() === null) reportConnectError(id, err);
    throw err;
  }
}

export function registerNavigatorReconnect(): void {
  if (typeof navigator === 'undefined' || !('usb' in navigator)) return;
  navigator.usb.addEventListener('connect', (event: USBConnectionEvent) => {
    if (!matchesDspi(event.device)) return;
    if (event.device.serialNumber && recordBySerial(event.device.serialNumber)) return;   // already adopted
    if (inflightBoot || adoptionInProgress()) return;
    Log.info('reconnect', 'granted device re-enumerated, adopting in the background');
    // Failures never paint over a live device (the reducer's active-session
    // rule hides the failed dispatch); when idle, adoptReconnectedDevice
    // classifies the hero that does show.
    void adoptReconnectedDevice(event.device).catch((e) => Log.error('reconnect', 'auto-reconnect failed', e));
  });
}
