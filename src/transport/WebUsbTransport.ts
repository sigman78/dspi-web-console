import { type DspTransport, type TransportEvent, VENDOR_INTERFACE_INDEX } from './DspTransport';

// Firmware changed its USB Vendor ID at 1.1.4 (0x2E8A -> 0x2E8B); PID unchanged.
// Both pairs listed so either firmware shows in the picker. VID is a
// device-family check only; the supported-version decision comes from GetPlatform.
export const DSPI_USB_IDS = [
  { vendorId: 0x2E8A, productId: 0xFEAA },  // <= 1.1.3
  { vendorId: 0x2E8B, productId: 0xFEAA },  // >= 1.1.4
] as const;

export function matchesDspi(d: { vendorId: number; productId: number }): boolean {
  return DSPI_USB_IDS.some((id) => d.vendorId === id.vendorId && d.productId === id.productId);
}

const USB_CLASS_VENDOR = 0xFF;

// Thrown when the vendor interface can't be claimed -- almost always because the
// device is already open (another browser tab, the DSPi Console app, or another
// process), or on Windows because the interface isn't bound to WinUSB. Tagged so
// the connect path can surface a "device in use" advisory instead of a raw error.
export class DeviceInUse extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'DeviceInUse';
  }
}

export class WebUsbTransport implements DspTransport {
  #device: USBDevice | null = null;
  #interfaceNumber = VENDOR_INTERFACE_INDEX;
  #notifyEndpoint: number | null = null;
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
  // Distinguishes "no WebUSB" from "insecure context" (the common LAN-dev gotcha).
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
    const match = devices.find(matchesDspi);
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
      filters: [...DSPI_USB_IDS],
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
      throw new DeviceInUse(claimErrorHint(err, d, this.#interfaceNumber), { cause: err });
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

  // Resolve the bulk-IN notify endpoint lazily (scan the interface; default 3),
  // then read one packet.
  async notifyIn(length: number): Promise<Uint8Array> {
    const d = this.#requireDevice();
    if (this.#notifyEndpoint === null) {
      this.#notifyEndpoint = findNotifyEndpoint(d, this.#interfaceNumber) ?? 3;
    }
    const r = await d.transferIn(this.#notifyEndpoint, length);
    if (r.status === 'stall') {
      // Clear the halt so the next read can succeed; without this the endpoint
      // stays wedged. The notify channel backs off and retries.
      await d.clearHalt('in', this.#notifyEndpoint);
      throw new Error('notifyIn: endpoint stalled (halt cleared)');
    }
    if (r.status !== 'ok' || !r.data) {
      throw new Error(`notifyIn status=${r.status}`);
    }
    return new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.byteLength);
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

// Find the bulk-IN endpoint number on the claimed vendor interface (the notify
// endpoint, EP 0x83). Returns the endpoint number (1..15), or null if absent.
function findNotifyEndpoint(d: USBDevice, interfaceNumber: number): number | null {
  const iface = d.configuration?.interfaces.find((i) => i.interfaceNumber === interfaceNumber);
  const ep = iface?.alternate.endpoints.find((e) => e.direction === 'in' && e.type === 'bulk');
  return ep ? ep.endpointNumber : null;
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
    `Also confirm the device isn't already open in another browser tab, and that the DSPi Console app is closed.`
  );
}
