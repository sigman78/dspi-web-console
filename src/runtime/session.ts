import { DspDevice } from '../device/DspDevice';
import type { DspTransport } from '../transport/DspTransport';
import { MockTransport } from '../transport/MockTransport';
import {
  DSPI_PRODUCT_ID,
  DSPI_VENDOR_ID,
  WebUsbTransport,
} from '../transport/WebUsbTransport';
import { withTimeout } from '../transport/withTimeout';
import { attachTransportListeners, finishConnection } from './actions';
import { session, setStatus, bindDevice } from '../state/session.svelte';
import { settings } from '../state/settings.svelte';
import { error as logError, log } from '../utils/log';

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

async function createBoundDevice(
  transport: DspTransport,
  openTransport?: () => Promise<void>,
): Promise<DspDevice> {
  // Wrap with the timeout decorator before handing to DspDevice so every
  // ctrlIn/ctrlOut inherits the deadline. attachTransportListeners stays
  // on the underlying transport -- connect/disconnect events come from the
  // real transport, not from the timeout wrapper.
  const wrapped = withTimeout(transport, { ctrlMs: CTRL_TIMEOUT_MS });
  try {
    const device = await DspDevice.create(wrapped, openTransport);
    bindDevice(device);
    attachTransportListeners(transport);
    return device;
  } catch (err) {
    bindDevice(null);
    try {
      await transport.close();
    } catch (closeErr) {
      logError('connect', 'cleanup close after failed init failed', closeErr);
    }
    throw err;
  }
}

export async function connectRequested(): Promise<void> {
  try {
    setStatus('connecting');
    const transport = new WebUsbTransport();
    const device = await createBoundDevice(transport, () => transport.requestAndOpen());
    await finishConnection(device);
  } catch (err) {
    logError('connect', 'connect failed', err);
    setStatus('error', (err as Error).message);
    throw err;
  }
}

export async function bootMock(platform: 'rp2040' | 'rp2350'): Promise<void> {
  const transport = new MockTransport({ platform });
  const device = await createBoundDevice(transport);
  await finishConnection(device);
}

export async function bootReal(): Promise<void> {
  if (booting) return;
  booting = true;
  try {
    const transport = new WebUsbTransport();
    const ok = await transport.tryAutoConnect();
    if (!ok) return;
    const device = await createBoundDevice(transport, async () => {});
    await finishConnection(device);
  } finally {
    booting = false;
  }
}

export function registerNavigatorReconnect(): void {
  if (typeof navigator === 'undefined' || !('usb' in navigator)) return;
  navigator.usb.addEventListener('connect', (event: USBConnectionEvent) => {
    const target = settings.lastSerial;
    if (!target) return;
    if (event.device.vendorId !== DSPI_VENDOR_ID) return;
    if (event.device.productId !== DSPI_PRODUCT_ID) return;
    if (event.device.serialNumber !== target) return;
    if (booting) return;
    if (session.status === 'connected' || session.status === 'connecting') return;
    log('reconnect', 'last-known device re-enumerated, attempting bootReal()');
    void bootReal().catch((err) => setStatus('error', (err as Error).message));
  });
}
