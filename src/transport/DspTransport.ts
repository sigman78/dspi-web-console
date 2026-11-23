// All transports speak the DSPi vendor-control protocol on interface 2.

// USB interface index where the firmware exposes vendor control transfers
export const VENDOR_INTERFACE_INDEX = 2;

export type TransportEvent = 'connect' | 'disconnect';

// The device refused a control request (USB STALL). Distinct from timeouts and
// disconnects: it is a protocol answer, e.g. "no such command on this firmware".
export class TransportStall extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'TransportStall';
  }
}

// A device or console refusal that is not a link fault: the request was
// declined (or never sent) and the link itself is fine.
export class RefusedError extends Error {}

// A command ID is 16 bits: the page in the high byte, the command number in
// the low byte. Page 0 is the original single-byte opcode space, so its wire
// bytes are unchanged. `bRequest` carries the command number; the page rides
// in the high byte of `wIndex` above the interface number.
export function ctrlSetup(cmd: number, iface: number): { request: number; index: number } {
  return { request: cmd & 0xFF, index: (cmd & 0xFF00) | iface };
}

export interface DspTransport {
  open(): Promise<void>;
  close(): Promise<void>;
  isOpen(): boolean;

  // `cmd` is the 16-bit command ID (page << 8 | command number).
  ctrlIn(cmd: number, value: number, length: number): Promise<Uint8Array>;
  ctrlOut(cmd: number, value: number, data: Uint8Array): Promise<void>;

  // Read one notification packet from the bulk-IN notify endpoint (EP 0x83).
  // Optional: transports that don't expose the endpoint omit it; the notify
  // channel treats its absence as "no notifications".
  notifyIn?(length: number): Promise<Uint8Array>;

  on(event: TransportEvent, listener: () => void): () => void;
}
