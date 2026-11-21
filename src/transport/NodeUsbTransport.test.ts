import { describe, it, expect, vi } from 'vitest';
import type { Device } from 'usb';
import { NodeUsbTransport } from './NodeUsbTransport';
import { TransportStall } from './DspTransport';

type Callback = (err?: { errno: number; message: string } | null, data?: Uint8Array) => void;

async function openWith(controlTransfer: (...args: unknown[]) => void): Promise<NodeUsbTransport> {
  const device = {
    open() {},
    close() {},
    configDescriptor: { interfaces: [[{ bInterfaceClass: 0xFF, bInterfaceNumber: 2 }]] },
    interface: () => ({ claim() {}, release: (_k: boolean, cb: () => void) => cb() }),
    controlTransfer,
  } as unknown as Device;
  const transport = new NodeUsbTransport(device);
  await transport.open();
  return transport;
}

describe('NodeUsbTransport — 16-bit command IDs', () => {
  it('splits a paged ID into bRequest and the wIndex high byte, keeping page 0 unchanged', async () => {
    const controlTransfer = vi.fn((...args: unknown[]) => {
      (args[args.length - 1] as Callback)(null, new Uint8Array(1));
    });
    const transport = await openWith(controlTransfer);
    await transport.ctrlIn(0x74, 3, 1);
    await transport.ctrlIn(0x0110, 0, 16);
    await transport.ctrlOut(0x0521, 1, new Uint8Array(4));
    expect(controlTransfer).toHaveBeenNthCalledWith(1, 0xC1, 0x74, 3, 2, 1, expect.any(Function));
    expect(controlTransfer).toHaveBeenNthCalledWith(2, 0xC1, 0x10, 0, 0x0102, 16, expect.any(Function));
    expect(controlTransfer).toHaveBeenNthCalledWith(3, 0x41, 0x21, 1, 0x0502, expect.any(Uint8Array), expect.any(Function));
  });

  it('maps LIBUSB_TRANSFER_STALL to TransportStall and leaves other errors alone', async () => {
    const pipe = await openWith((...args) => (args[args.length - 1] as Callback)({ errno: 4, message: 'stall' }));
    await expect(pipe.ctrlIn(0x0110, 0, 16)).rejects.toBeInstanceOf(TransportStall);
    await expect(pipe.ctrlOut(0x10, 0, new Uint8Array(1))).rejects.toBeInstanceOf(TransportStall);

    const timeout = await openWith((...args) => (args[args.length - 1] as Callback)({ errno: 2, message: 'timeout' }));
    const err = await timeout.ctrlIn(0x10, 0, 1).catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(TransportStall);
  });
});
