import type { Device } from 'usb';
import { type DspTransport, type TransportEvent, VENDOR_INTERFACE_INDEX } from './DspTransport';

const USB_CLASS_VENDOR = 0xFF;

//
// libusb-backed DspTransport used by HIL tests. Mirrors WebUsbTransport's
// surface so DspDevice and the protocol parsers don't have to know which
// transport they're talking through.
//
// Hotplug events (the `'connect'`/`'disconnect'` listeners) are minimal
// for now: `'connect'` fires once on a successful open(), `'disconnect'`
// fires once on close(). Multi-device hotplug is phase 4.
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
    return new Promise((resolve, reject) => {
      this.#device.controlTransfer(
        VENDOR_IN, request, value, this.#interfaceNumber, length,
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
    // Pass the Uint8Array directly. The `usb` library's OUT validation is
    // `obj instanceof Uint8Array`. Under vitest with environment: 'jsdom',
    // global Uint8Array is jsdom's, while Node's Buffer extends Node's
    // separate Uint8Array -- so Buffer.from(data) produces an object that
    // fails the global instanceof check. Forwarding `data` works because
    // it was created with the same (global jsdom) Uint8Array constructor.
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
