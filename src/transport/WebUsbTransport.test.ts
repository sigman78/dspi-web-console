import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { matchesDspi, WebUsbTransport } from './WebUsbTransport';

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
