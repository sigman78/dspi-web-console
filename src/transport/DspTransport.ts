// All transports speak the DSPi vendor-control protocol on interface 2.

// USB interface index where the firmware exposes vendor control transfers
export const VENDOR_INTERFACE_INDEX = 2;

export type TransportEvent = 'connect' | 'disconnect';

export interface DspTransport {
  open(): Promise<void>;
  close(): Promise<void>;
  isOpen(): boolean;

  ctrlIn(request: number, value: number, length: number): Promise<Uint8Array>;
  ctrlOut(request: number, value: number, data: Uint8Array): Promise<void>;

  // Read one notification packet from the bulk-IN notify endpoint (EP 0x83).
  // Optional: transports that don't expose the endpoint omit it; the notify
  // channel treats its absence as "no notifications".
  notifyIn?(length: number): Promise<Uint8Array>;

  on(event: TransportEvent, listener: () => void): () => void;
}
