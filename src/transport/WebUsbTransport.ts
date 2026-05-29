import { type DspTransport, type TransportEvent, VENDOR_INTERFACE_INDEX } from './DspTransport';

export const DSPI_VENDOR_ID = 0x2E8A;
export const DSPI_PRODUCT_ID = 0xFEAA;
const USB_CLASS_VENDOR = 0xFF;

export class WebUsbTransport implements DspTransport {
  #device: USBDevice | null = null;
  #interfaceNumber = VENDOR_INTERFACE_INDEX;
  #listeners = new Map<TransportEvent, Set<() => void>>();
  #onConnect = (e: USBConnectionEvent) => {
    if (this.#device && e.device === this.#device) this.#emit('connect');
  };
  #onDisconnect = (e: USBConnectionEvent) => {
    if (this.#device && e.device === this.#device) this.#emit('disconnect');
  };

  static isSupported(): boolean {
    return typeof navigator !== 'undefined' && 'usb' in navigator;
  }

  // Human-readable reason WebUSB is unavailable, or null if it should work.
  //  Distinguishes "browser doesn't ship WebUSB" from "page is served from
  //  an insecure context"; the latter is the common LAN-dev-server gotcha. */
  static unsupportedReason(): string | null {
    if (typeof navigator === 'undefined') return 'No navigator (SSR/no DOM).';
    if (typeof window !== 'undefined' && window.isSecureContext === false) {
      const origin = `${location.protocol}//${location.host}`;
      return `Insecure context: ${origin}. WebUSB needs HTTPS or http://localhost. ` +
             `For LAN access, use a tunnel (e.g. \`vite --host --https\`, ngrok, cloudflared) ` +
             `or whitelist this origin in chrome://flags/#unsafely-treat-insecure-origin-as-secure.`;
    }
    if (!('usb' in navigator)) {
      return "This browser can't talk to USB devices. Open the console in a " +
             'Chromium-based browser such as Google Chrome, Microsoft Edge, or Opera.';
    }
    return null;
  }

  async tryAutoConnect(): Promise<boolean> {
    if (!WebUsbTransport.isSupported()) return false;
    const devices = await navigator.usb.getDevices();
    const match = devices.find(
      (d) => d.vendorId === DSPI_VENDOR_ID && d.productId === DSPI_PRODUCT_ID,
    );
    if (!match) return false;
    this.#device = match;
    await this.open();
    return true;
  }

  async requestAndOpen(): Promise<void> {
    if (!WebUsbTransport.isSupported()) {
      throw new Error('WebUSB is not supported in this browser.');
    }
    const device = await navigator.usb.requestDevice({
      filters: [{ vendorId: DSPI_VENDOR_ID, productId: DSPI_PRODUCT_ID }],
    });
    this.#device = device;
    await this.open();
  }

  async open(): Promise<void> {
    const d = this.#device;
    if (!d) throw new Error('No device selected.');
    if (!d.opened) await d.open();
    if (d.configuration === null) await d.selectConfiguration(1);

    this.#interfaceNumber = pickVendorInterface(d);

    try {
      await d.claimInterface(this.#interfaceNumber);
    } catch (err) {
      throw new Error(claimErrorHint(err, d, this.#interfaceNumber), { cause: err });
    }

    navigator.usb.addEventListener('connect', this.#onConnect);
    navigator.usb.addEventListener('disconnect', this.#onDisconnect);
    this.#emit('connect');
  }

  async close(): Promise<void> {
    const d = this.#device;
    navigator.usb.removeEventListener('connect', this.#onConnect);
    navigator.usb.removeEventListener('disconnect', this.#onDisconnect);
    if (d?.opened) {
      try { await d.releaseInterface(this.#interfaceNumber); } catch {}
      try { await d.close(); } catch {}
    }
    this.#emit('disconnect');
  }

  isOpen(): boolean { return !!this.#device?.opened; }

  async ctrlIn(request: number, value: number, length: number): Promise<Uint8Array> {
    const d = this.#requireDevice();
    const r = await d.controlTransferIn(
      { requestType: 'vendor', recipient: 'interface', request, value, index: this.#interfaceNumber },
      length,
    );
    if (r.status !== 'ok' || !r.data) {
      throw new Error(`controlTransferIn(${request.toString(16)}) status=${r.status}`);
    }
    return new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.byteLength);
  }

  async ctrlOut(request: number, value: number, data: Uint8Array): Promise<void> {
    const d = this.#requireDevice();
    const payload = new ArrayBuffer(data.byteLength);
    new Uint8Array(payload).set(data);
    const r = await d.controlTransferOut(
      { requestType: 'vendor', recipient: 'interface', request, value, index: this.#interfaceNumber },
      payload,
    );
    if (r.status !== 'ok') {
      throw new Error(`controlTransferOut(${request.toString(16)}) status=${r.status}`);
    }
  }

  on(event: TransportEvent, listener: () => void): () => void {
    let set = this.#listeners.get(event);
    if (!set) { set = new Set(); this.#listeners.set(event, set); }
    set.add(listener);
    return () => set!.delete(listener);
  }

  #emit(event: TransportEvent): void {
    this.#listeners.get(event)?.forEach((l) => l());
  }

  #requireDevice(): USBDevice {
    if (!this.#device) throw new Error('WebUsbTransport: no device.');
    return this.#device;
  }
}

// Pick the vendor-class (0xFF) interface from the active configuration. Falls
// back to the hard-coded default if no vendor interface is exposed (which
// would itself indicate a misconfigured driver binding on the OS side).
function pickVendorInterface(d: USBDevice): number {
  const cfg = d.configuration;
  if (!cfg) return VENDOR_INTERFACE_INDEX;
  for (const iface of cfg.interfaces) {
    const alt = iface.alternate;
    if (alt && alt.interfaceClass === USB_CLASS_VENDOR) {
      return iface.interfaceNumber;
    }
  }
  return VENDOR_INTERFACE_INDEX;
}

function claimErrorHint(err: unknown, d: USBDevice, ifNum: number): string {
  const msg = (err as Error)?.message ?? String(err);
  const cfg = d.configuration;
  const layout = cfg
    ? cfg.interfaces.map((i) => {
        const a = i.alternate;
        const cls = a ? `class=0x${a.interfaceClass.toString(16).padStart(2, '0')}` : 'no-alt';
        return `#${i.interfaceNumber}(${cls}, claimed=${i.claimed})`;
      }).join(' ')
    : 'no-config';
  return (
    `${msg} — tried interface ${ifNum}. Device exposes: ${layout}. ` +
    `On Windows, the vendor (class=0xff) interface must be bound to WinUSB ` +
    `via Zadig (rebind the entry whose name ends "(Interface ${ifNum})" / "MI_0${ifNum}"). ` +
    `Also confirm that DSPi Console App is closed.`
  );
}
