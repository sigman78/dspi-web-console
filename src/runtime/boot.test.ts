import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { bootReal, bootMock, bootMockFleet, connectRequested, registerNavigatorReconnect } from './boot';
import { MockTransport } from '@/transport/MockTransport';
import {
  dispatch, mintConnId, settings, connection, resetAppState,
  sessionRecords, activeRecord, recordBySerial, adoptFailures, noteAdoptFailure,
  notices, clearNotices,
} from '@/state';

// Bridges the WebUSB device surface WebUsbTransport actually touches
// (opened/configuration/claimInterface/controlTransferIn/Out) onto a
// MockTransport instance, so bootReal / registerNavigatorReconnect can be
// driven through their real navigator.usb boundary rather than by poking
// appState/deviceService internals directly.
function usbDeviceFromMock(mock: MockTransport, opts: { serial: string; vendorId?: number; productId?: number }): USBDevice {
  const configuration = {
    interfaces: [{
      interfaceNumber: 0,
      claimed: false,
      alternate: { interfaceClass: 0xFF, endpoints: [{ endpointNumber: 3, direction: 'in', type: 'bulk' }] },
    }],
  };
  return {
    vendorId: opts.vendorId ?? 0x2E8B,
    productId: opts.productId ?? 0xFEAA,
    serialNumber: opts.serial,
    configuration,
    get opened() { return mock.isOpen(); },
    async open() { await mock.open(); },
    async close() { await mock.close(); },
    async selectConfiguration() {},
    async claimInterface() {},
    async releaseInterface() {},
    async clearHalt() {},
    async controlTransferIn(setup: USBControlTransferParameters, length: number) {
      const data = await mock.ctrlIn(setup.request, setup.value, length);
      return { status: 'ok', data: new DataView(data.buffer, data.byteOffset, data.byteLength) };
    },
    async controlTransferOut(setup: USBControlTransferParameters, data?: BufferSource) {
      const view = data instanceof ArrayBuffer
        ? new Uint8Array(data)
        : new Uint8Array((data as ArrayBufferView).buffer, (data as ArrayBufferView).byteOffset, (data as ArrayBufferView).byteLength);
      await mock.ctrlOut(setup.request, setup.value, view);
      return { status: 'ok', bytesWritten: view.byteLength };
    },
    async transferIn(_endpoint: number, length: number) {
      const data = await mock.notifyIn(length);
      return { status: 'ok', data: new DataView(data.buffer, data.byteOffset, data.byteLength) };
    },
  } as unknown as USBDevice;
}

// A granted device whose open() never succeeds (claim failure, unplug mid-init, ...).
function failingUsbDevice(serial: string): USBDevice {
  return {
    vendorId: 0x2E8B,
    productId: 0xFEAA,
    serialNumber: serial,
    opened: false,
    configuration: { interfaces: [{ interfaceNumber: 0, claimed: false, alternate: { interfaceClass: 0xFF, endpoints: [] } }] },
    async open() { throw new Error('device unavailable'); },
    async close() {},
    async selectConfiguration() {},
    async claimInterface() {},
    async releaseInterface() {},
  } as unknown as USBDevice;
}

class FakeUsb {
  #listeners = new Map<string, Set<(e: USBConnectionEvent) => void>>();
  granted: USBDevice[] = [];
  nextPicked: USBDevice | null = null;

  async getDevices(): Promise<USBDevice[]> { return this.granted; }
  async requestDevice(): Promise<USBDevice> {
    if (!this.nextPicked) throw new DOMException('cancelled', 'NotFoundError');
    return this.nextPicked;
  }
  addEventListener(type: string, listener: (e: USBConnectionEvent) => void): void {
    let set = this.#listeners.get(type);
    if (!set) { set = new Set(); this.#listeners.set(type, set); }
    set.add(listener);
  }
  removeEventListener(type: string, listener: (e: USBConnectionEvent) => void): void {
    this.#listeners.get(type)?.delete(listener);
  }
  fire(type: string, device: USBDevice): void {
    const event = { device } as USBConnectionEvent;
    for (const l of this.#listeners.get(type) ?? []) l(event);
  }
}

let fakeUsb: FakeUsb;

beforeEach(() => {
  resetAppState();
  fakeUsb = new FakeUsb();
  Object.defineProperty(navigator, 'usb', { value: fakeUsb, configurable: true });
});

afterEach(() => {
  for (const rec of sessionRecords().values()) rec.session.dispose();
  resetAppState();
  Reflect.deleteProperty(navigator as unknown as Record<string, unknown>, 'usb');
});

describe('bootReal — adopt-all-granted-devices loop', () => {
  it('single granted device: adopts and activates it, sets lastSerial, starts loops (byte-identical to single-device boot)', async () => {
    fakeUsb.granted = [usbDeviceFromMock(new MockTransport({ platform: 'rp2350', serial: 'SOLO' }), { serial: 'SOLO' })];

    await bootReal();

    const rec = recordBySerial('SOLO')!;
    expect(activeRecord()?.id).toBe(rec.id);
    expect(rec.loops).not.toBeNull();
    expect(settings.lastSerial).toBe('SOLO');
    expect(connection.phase).toBe('ready');
  });

  it('is a no-op with no granted devices', async () => {
    fakeUsb.granted = [];
    await bootReal();
    expect(connection.phase).toBe('noDevice');
    expect(sessionRecords().size).toBe(0);
  });

  it('adopts both granted devices; the first is active, the second dormant with no loops', async () => {
    fakeUsb.granted = [
      usbDeviceFromMock(new MockTransport({ platform: 'rp2350', serial: 'AAA' }), { serial: 'AAA' }),
      usbDeviceFromMock(new MockTransport({ platform: 'rp2350', serial: 'BBB' }), { serial: 'BBB' }),
    ];

    await bootReal();

    expect(sessionRecords().size).toBe(2);
    const a = recordBySerial('AAA')!;
    const b = recordBySerial('BBB')!;
    expect(activeRecord()?.id).toBe(a.id);
    expect(a.loops).not.toBeNull();
    expect(b.loops).toBeNull();
  });

  it('activates the record named by settings.lastSerial when it differs from the first-adopted device', async () => {
    settings.lastSerial = 'BBB';
    fakeUsb.granted = [
      usbDeviceFromMock(new MockTransport({ platform: 'rp2350', serial: 'AAA' }), { serial: 'AAA' }),
      usbDeviceFromMock(new MockTransport({ platform: 'rp2350', serial: 'BBB' }), { serial: 'BBB' }),
    ];

    await bootReal();

    const a = recordBySerial('AAA')!;
    const b = recordBySerial('BBB')!;
    expect(activeRecord()?.id).toBe(b.id);
    expect(a.loops).toBeNull();
    expect(b.loops).not.toBeNull();
  });

  it('keeps the working device active when another granted device fails to open, with no errored attempt visible, and records a badge for the straggler', async () => {
    fakeUsb.granted = [
      usbDeviceFromMock(new MockTransport({ platform: 'rp2350', serial: 'AAA' }), { serial: 'AAA' }),
      failingUsbDevice('BBB'),
    ];

    await bootReal();

    expect(sessionRecords().size).toBe(1);
    const a = recordBySerial('AAA')!;
    expect(activeRecord()?.id).toBe(a.id);
    expect(a.loops).not.toBeNull();
    expect(connection.phase).toBe('ready');
    expect(adoptFailures().has('BBB')).toBe(true);
    expect(adoptFailures().get('BBB')?.message).toBeTruthy();
  });

  it('activates the first device that actually adopts even when an earlier device in the list failed', async () => {
    fakeUsb.granted = [
      failingUsbDevice('AAA'),
      usbDeviceFromMock(new MockTransport({ platform: 'rp2350', serial: 'BBB' }), { serial: 'BBB' }),
    ];

    await bootReal();

    expect(sessionRecords().size).toBe(1);
    const b = recordBySerial('BBB')!;
    expect(activeRecord()?.id).toBe(b.id);
    expect(b.loops).not.toBeNull();
    expect(connection.phase).toBe('ready');
  });

  it('paints the errored hero only when every granted device fails to adopt, recording no badges', async () => {
    fakeUsb.granted = [failingUsbDevice('AAA'), failingUsbDevice('BBB')];

    await bootReal();

    expect(sessionRecords().size).toBe(0);
    expect(connection.phase).toBe('errored');
    expect(adoptFailures().size).toBe(0);
  });
});

describe('connectRequested — picker-first duplicate-serial guard', () => {
  it('activates the existing session instead of claiming the interface a second time', async () => {
    await bootMock('rp2350', { serial: 'DUP' });
    const existing = activeRecord()!;
    await bootMock('rp2350', { serial: 'OTHER' });   // now dormant/active swap target
    expect(activeRecord()?.id).not.toBe(existing.id);

    const open = vi.fn(async () => {});
    const claimInterface = vi.fn(async () => {});
    fakeUsb.nextPicked = {
      vendorId: 0x2E8B, productId: 0xFEAA, serialNumber: 'DUP', open, claimInterface,
    } as unknown as USBDevice;

    await connectRequested();

    expect(activeRecord()?.id).toBe(existing.id);
    expect(sessionRecords().size).toBe(2);   // no third record created
    expect(open).not.toHaveBeenCalled();
    expect(claimInterface).not.toHaveBeenCalled();
  });

  it('reports the errored attempt when the picker is cancelled, as today', async () => {
    fakeUsb.nextPicked = null;

    await expect(connectRequested()).rejects.toThrow();

    expect(connection.phase).toBe('errored');
    expect(sessionRecords().size).toBe(0);
  });

  it('does nothing while an adoption attempt is already in flight', async () => {
    dispatch({ t: 'requested', id: mintConnId() });
    const requestDevice = vi.spyOn(fakeUsb, 'requestDevice');

    await connectRequested();

    expect(requestDevice).not.toHaveBeenCalled();
    expect(sessionRecords().size).toBe(0);
  });
});

describe('connectRequested — badge recording while a device is live', () => {
  it('records a badge for the picked serial when adoption fails after the picker, leaving the live device active', async () => {
    await bootMock('rp2350', { serial: 'LIVE' });
    fakeUsb.nextPicked = failingUsbDevice('BADPICK');

    await expect(connectRequested()).rejects.toThrow();

    expect(connection.phase).toBe('ready');
    expect(activeRecord()?.session.info.serial).toBe('LIVE');
    expect(adoptFailures().has('BADPICK')).toBe(true);
    expect(adoptFailures().get('BADPICK')?.message).toBeTruthy();
  });

  it('records no badge when the picker is cancelled while a device is live', async () => {
    await bootMock('rp2350', { serial: 'LIVE' });
    fakeUsb.nextPicked = null;

    await expect(connectRequested()).rejects.toThrow();

    expect(connection.phase).toBe('ready');
    expect(adoptFailures().size).toBe(0);
  });

  it('falls back to an error notice when the picked device carries no serial to key a badge by', async () => {
    clearNotices();
    await bootMock('rp2350', { serial: 'LIVE' });
    const anon = failingUsbDevice('IGNORED');
    Reflect.set(anon as unknown as Record<string, unknown>, 'serialNumber', undefined);
    fakeUsb.nextPicked = anon;

    await expect(connectRequested()).rejects.toThrow();

    expect(connection.phase).toBe('ready');
    expect(adoptFailures().size).toBe(0);
    expect(notices.list.some((n) => n.kind === 'error')).toBe(true);
    clearNotices();
  });
});

describe('registerNavigatorReconnect — grant-is-the-policy adoption', () => {
  it('ignores a re-plug of a device this origin was never granted (foreign vendor id)', () => {
    registerNavigatorReconnect();
    const foreign = usbDeviceFromMock(new MockTransport({ platform: 'rp2350', serial: 'X' }), { serial: 'X', vendorId: 0x1234 });

    fakeUsb.fire('connect', foreign);

    expect(sessionRecords().size).toBe(0);
  });

  it('ignores a replug of a serial that is already adopted', async () => {
    await bootMock('rp2350', { serial: 'ABC' });
    registerNavigatorReconnect();
    const replug = usbDeviceFromMock(new MockTransport({ platform: 'rp2350', serial: 'ABC' }), { serial: 'ABC' });

    fakeUsb.fire('connect', replug);
    await Promise.resolve();

    expect(sessionRecords().size).toBe(1);
  });

  it('ignores a replug while an adoption attempt is already in flight', async () => {
    registerNavigatorReconnect();
    dispatch({ t: 'requested', id: mintConnId() });
    const unknown = usbDeviceFromMock(new MockTransport({ platform: 'rp2350', serial: 'NEW' }), { serial: 'NEW' });

    fakeUsb.fire('connect', unknown);
    await Promise.resolve();

    expect(sessionRecords().size).toBe(0);
  });

  it('adopts an unknown granted device and activates it while idle', async () => {
    registerNavigatorReconnect();
    const solo = usbDeviceFromMock(new MockTransport({ platform: 'rp2350', serial: 'SOLO' }), { serial: 'SOLO' });

    fakeUsb.fire('connect', solo);
    await vi.waitFor(() => expect(sessionRecords().size).toBe(1));

    const rec = recordBySerial('SOLO')!;
    expect(activeRecord()?.id).toBe(rec.id);
    expect(rec.loops).not.toBeNull();
  });

  it('adopts an unknown granted device dormant, never stealing focus from the active device', async () => {
    await bootMock('rp2350', { serial: 'ACTIVE' });
    registerNavigatorReconnect();
    const other = usbDeviceFromMock(new MockTransport({ platform: 'rp2350', serial: 'OTHER' }), { serial: 'OTHER' });

    fakeUsb.fire('connect', other);
    await vi.waitFor(() => expect(sessionRecords().size).toBe(2));

    const active = recordBySerial('ACTIVE')!;
    const dormant = recordBySerial('OTHER')!;
    expect(activeRecord()?.id).toBe(active.id);
    expect(dormant.loops).toBeNull();
  });
});

// A granted device whose vendor interface can't be claimed (already open in
// another tab or process) -- exercises the DeviceInUse classification path.
function claimFailingUsbDevice(serial: string): USBDevice {
  return {
    vendorId: 0x2E8B,
    productId: 0xFEAA,
    serialNumber: serial,
    opened: true,
    configuration: { interfaces: [{ interfaceNumber: 0, claimed: true, alternate: { interfaceClass: 0xFF, endpoints: [] } }] },
    async open() {},
    async close() {},
    async selectConfiguration() {},
    async claimInterface() { throw new Error('claim failed'); },
    async releaseInterface() {},
  } as unknown as USBDevice;
}

describe('registerNavigatorReconnect — failure surfacing', () => {
  it('a replug that fails to claim while idle paints the classified errored hero', async () => {
    registerNavigatorReconnect();
    fakeUsb.fire('connect', claimFailingUsbDevice('BUSY'));

    await vi.waitFor(() => expect(connection.phase).toBe('errored'));
    expect(connection.errorKind).toBe('device-in-use');
    expect(sessionRecords().size).toBe(0);
  });

  it('a replug that fails while another device is live stays silent', async () => {
    fakeUsb.granted = [usbDeviceFromMock(new MockTransport({ platform: 'rp2350', serial: 'LIVE' }), { serial: 'LIVE' })];
    await bootReal();
    expect(connection.phase).toBe('ready');

    registerNavigatorReconnect();
    fakeUsb.fire('connect', claimFailingUsbDevice('BUSY'));
    await new Promise((r) => setTimeout(r, 25));

    expect(connection.phase).toBe('ready');
    expect(connection.error).toBeNull();
    expect(recordBySerial('BUSY')).toBeNull();
    expect(activeRecord()?.session.info.serial).toBe('LIVE');
  });
});

describe('bootMockFleet', () => {
  it('boots one device per profile: first active, rest dormant, distinct serials', async () => {
    await bootMockFleet([
      { name: 'latest', platform: 'rp2350', opts: {} },
      { name: 'legacy', platform: 'rp2040', opts: { wireVersion: 10, fwVersion: { major: 1, minor: 1, patch: 4 } } },
    ]);

    expect(sessionRecords().size).toBe(2);
    const first = recordBySerial('MOCK-RP2350-1')!;
    const second = recordBySerial('MOCK-RP2040-2')!;
    expect(activeRecord()?.id).toBe(first.id);
    expect(first.loops).not.toBeNull();
    expect(second.loops).toBeNull();
  });

  it('a single profile keeps the plain bootMock behavior (default serial, active)', async () => {
    await bootMockFleet([{ name: 'latest', platform: 'rp2350', opts: {} }]);

    expect(sessionRecords().size).toBe(1);
    expect(activeRecord()?.loops).not.toBeNull();
    expect(activeRecord()?.session.info.serial).not.toContain('MOCK-RP2350-1');
  });
});

describe('badge lifecycle: a successful re-adoption clears its serial\'s badge', () => {
  it('clears the badge once the same serial adopts successfully', async () => {
    noteAdoptFailure({ serial: 'RETRY', message: 'boot adoption failed', errorKind: null });
    expect(adoptFailures().has('RETRY')).toBe(true);

    await bootMock('rp2350', { serial: 'RETRY' });

    expect(adoptFailures().has('RETRY')).toBe(false);
  });
});
