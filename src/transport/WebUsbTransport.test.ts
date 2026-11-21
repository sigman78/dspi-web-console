import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { matchesDspi, WebUsbTransport } from './WebUsbTransport';
import { TransportStall } from './DspTransport';

describe('DSPi USB identity', () => {
  it('matches a device on either vendor id with the shared product id', () => {
    expect(matchesDspi({ vendorId: 0x2e8a, productId: 0xfeaa })).toBe(true);
    expect(matchesDspi({ vendorId: 0x2e8b, productId: 0xfeaa })).toBe(true);
  });

  it('rejects a foreign vendor or a mismatched product id', () => {
    expect(matchesDspi({ vendorId: 0x1234, productId: 0xfeaa })).toBe(false);
    expect(matchesDspi({ vendorId: 0x2e8b, productId: 0x0001 })).toBe(false);
  });
});

// A device that satisfies just enough of the surface WebUsbTransport.open()
// touches to succeed without a real WebUSB backend.
function stubDevice(serial: string): USBDevice {
  return {
    vendorId: 0x2E8B,
    productId: 0xFEAA,
    serialNumber: serial,
    opened: false,
    configuration: { interfaces: [{ interfaceNumber: 0, claimed: false, alternate: { interfaceClass: 0xFF, endpoints: [] } }] },
    async open() {},
    async close() {},
    async selectConfiguration() {},
    async claimInterface() {},
    async releaseInterface() {},
  } as unknown as USBDevice;
}

describe('WebUsbTransport — picker/target boundary', () => {
  let fakeUsb: { getDevices: ReturnType<typeof vi.fn>; requestDevice: ReturnType<typeof vi.fn>; addEventListener: ReturnType<typeof vi.fn>; removeEventListener: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    fakeUsb = {
      getDevices: vi.fn(async () => []),
      requestDevice: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    Object.defineProperty(navigator, 'usb', { value: fakeUsb, configurable: true });
  });

  afterEach(() => {
    Reflect.deleteProperty(navigator as unknown as Record<string, unknown>, 'usb');
  });

  it('tryAutoConnect() opens a constructor-provided target directly, without scanning getDevices()', async () => {
    const transport = new WebUsbTransport(stubDevice('PRE-ENUMERATED'));
    const ok = await transport.tryAutoConnect();
    expect(ok).toBe(true);
    expect(fakeUsb.getDevices).not.toHaveBeenCalled();
  });

  it('tryAutoConnect() scans getDevices() for the first DSPi match when constructed with no target', async () => {
    fakeUsb.getDevices.mockResolvedValue([stubDevice('FOUND')]);
    const transport = new WebUsbTransport();
    const ok = await transport.tryAutoConnect();
    expect(ok).toBe(true);
    expect(fakeUsb.getDevices).toHaveBeenCalledTimes(1);
  });

  it('ctrlIn() resolves an ok transfer without a data view as an empty reply', async () => {
    const dev = Object.assign(stubDevice('EMPTY'), {
      controlTransferIn: vi.fn(async () => ({ status: 'ok', data: undefined })),
    });
    const transport = new WebUsbTransport(dev);
    await transport.tryAutoConnect();
    expect(await transport.ctrlIn(0x0F, 0, 738)).toEqual(new Uint8Array(0));
  });

  it('requestDevice() resolves the picked device without opening or claiming it', async () => {
    const picked = stubDevice('PICKED');
    const claimInterface = vi.spyOn(picked, 'claimInterface');
    fakeUsb.requestDevice.mockResolvedValue(picked);

    const transport = new WebUsbTransport();
    const resolved = await transport.requestDevice();

    expect(resolved).toBe(picked);
    expect(claimInterface).not.toHaveBeenCalled();
  });

  it('requestAndOpen() is requestDevice() followed by open() (claims the interface)', async () => {
    const picked = stubDevice('PICKED');
    const claimInterface = vi.spyOn(picked, 'claimInterface');
    fakeUsb.requestDevice.mockResolvedValue(picked);

    const transport = new WebUsbTransport();
    await transport.requestAndOpen();

    expect(claimInterface).toHaveBeenCalledTimes(1);
  });
});

describe('WebUsbTransport — 16-bit command IDs', () => {
  afterEach(() => {
    Reflect.deleteProperty(navigator as unknown as Record<string, unknown>, 'usb');
  });

  async function open(extra: Partial<USBDevice>): Promise<WebUsbTransport> {
    Object.defineProperty(navigator, 'usb', {
      value: { getDevices: async () => [], addEventListener() {}, removeEventListener() {} },
      configurable: true,
    });
    const transport = new WebUsbTransport(Object.assign(stubDevice('IDS'), extra));
    await transport.tryAutoConnect();
    return transport;
  }

  it('sends a page-0 command with its byte as bRequest and only the interface in wIndex', async () => {
    const controlTransferIn = vi.fn(async () => ({ status: 'ok', data: new DataView(new ArrayBuffer(1)) }));
    const transport = await open({ controlTransferIn } as Partial<USBDevice>);
    await transport.ctrlIn(0x74, 3, 1);
    expect(controlTransferIn).toHaveBeenCalledWith(
      { requestType: 'vendor', recipient: 'interface', request: 0x74, value: 3, index: 0 }, 1);
  });

  it('splits a paged ID into bRequest and the wIndex high byte, for IN and OUT', async () => {
    const controlTransferIn = vi.fn(async () => ({ status: 'ok', data: new DataView(new ArrayBuffer(1)) }));
    const controlTransferOut = vi.fn(async () => ({ status: 'ok', bytesWritten: 0 }));
    const transport = await open({ controlTransferIn, controlTransferOut } as Partial<USBDevice>);
    await transport.ctrlIn(0x0110, 0, 16);
    await transport.ctrlOut(0x0521, 1, new Uint8Array(4));
    expect(controlTransferIn).toHaveBeenCalledWith(expect.objectContaining({ request: 0x10, index: 0x0100 }), 16);
    expect(controlTransferOut).toHaveBeenCalledWith(expect.objectContaining({ request: 0x21, index: 0x0500 }), expect.anything());
  });

  it('maps a stalled transfer to TransportStall and other failures to a plain error', async () => {
    const stalled = await open({ controlTransferIn: vi.fn(async () => ({ status: 'stall' })) } as Partial<USBDevice>);
    await expect(stalled.ctrlIn(0x0110, 0, 16)).rejects.toBeInstanceOf(TransportStall);

    const babble = await open({ controlTransferOut: vi.fn(async () => ({ status: 'babble', bytesWritten: 0 })) } as Partial<USBDevice>);
    const err = await babble.ctrlOut(0x10, 0, new Uint8Array(1)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(TransportStall);
  });
});
