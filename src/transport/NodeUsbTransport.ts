import type { Device } from 'usb';
import { type DspTransport, type TransportEvent, VENDOR_INTERFACE_INDEX } from './DspTransport';

const USB_CLASS_VENDOR = 0xFF;

// libusb's Windows backend rejects control transfers above 4096 bytes
// (MAX_CTRL_BUFFER_LENGTH) with LIBUSB_ERROR_INVALID_PARAM. Clamp IN
// requests so an oversized single-shot read returns a truncated buffer
// instead of failing outright -- the parser's own length checks then
// produce a meaningful error. Firmware 1.1.5+ offers chunked bulk-params
// commands (0xA2/0xA3) that DspDevice uses automatically once the packet
// exceeds this cap, so this clamp is now a defensive guard against
// oversized foreign reads rather than a known-broken path; WebUSB (Chrome's
// own WinUSB path) is not subject to this libusb limit at all.
const LIBUSB_MAX_CTRL_LENGTH = 4096;

// libusb-backed DspTransport used by HIL tests. 'connect' fires on open(),
// 'disconnect' on close(); full hotplug is not yet wired.
export class NodeUsbTransport implements DspTransport {
  #device: Device;
  #interfaceNumber = VENDOR_INTERFACE_INDEX;
  #open = false;
  #listeners = new Map<TransportEvent, Set<() => void>>();

  constructor(device: Device) {
    this.#device = device;
  }

  async open(): Promise<void> {
    if (this.#open) return;
    this.#device.open();
    if (this.#device.configDescriptor == null) {
      await new Promise<void>((resolve, reject) => {
        this.#device.setConfiguration(1, (err) => err ? reject(err) : resolve());
      });
    }
    this.#interfaceNumber = pickVendorInterface(this.#device);
    const iface = this.#device.interface(this.#interfaceNumber);
    iface.claim();
    this.#open = true;
    this.#emit('connect');
  }

  async close(): Promise<void> {
    if (!this.#open) return;
    const iface = this.#device.interface(this.#interfaceNumber);
    await new Promise<void>((resolve) => {
      iface.release(true, () => resolve());
    });
    this.#device.close();
    this.#open = false;
    this.#emit('disconnect');
  }

  isOpen(): boolean { return this.#open; }

  ctrlIn(request: number, value: number, length: number): Promise<Uint8Array> {
    this.#requireOpen();
    const VENDOR_IN = 0xC1;
    const capped = Math.min(length, LIBUSB_MAX_CTRL_LENGTH);
    return new Promise((resolve, reject) => {
      this.#device.controlTransfer(
        VENDOR_IN, request, value, this.#interfaceNumber, capped,
        (err, data) => {
          if (err) return reject(err);
          if (!data || typeof data === 'number') {
            return reject(new Error('controlTransfer returned no data'));
          }
          resolve(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
        },
      );
    });
  }

  ctrlOut(request: number, value: number, data: Uint8Array): Promise<void> {
    this.#requireOpen();
    const VENDOR_OUT = 0x41;
    // Pass the Uint8Array directly. The `usb` library validates OUT with
    // `instanceof Uint8Array`; under vitest jsdom, Buffer.from(data) extends
    // Node's Uint8Array and fails the global (jsdom) check, but `data` passes.
    return new Promise((resolve, reject) => {
      this.#device.controlTransfer(
        VENDOR_OUT, request, value, this.#interfaceNumber, data,
        (err) => err ? reject(err) : resolve(),
      );
    });
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

  #requireOpen(): void {
    if (!this.#open) throw new Error('NodeUsbTransport: not open');
  }
}

function pickVendorInterface(d: Device): number {
  const cfg = d.configDescriptor;
  if (!cfg) return VENDOR_INTERFACE_INDEX;
  for (const iface of cfg.interfaces) {
    const alt = iface[0];
    if (alt && alt.bInterfaceClass === USB_CLASS_VENDOR) {
      return alt.bInterfaceNumber;
    }
  }
  return VENDOR_INTERFACE_INDEX;
}
