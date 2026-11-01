import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as Boot from './boot';
import { MockTransport } from '@/transport/MockTransport';
import * as State from '@/state';

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
  State.resetAppState();
  fakeUsb = new FakeUsb();
  Object.defineProperty(navigator, 'usb', { value: fakeUsb, configurable: true });
});

afterEach(() => {
  for (const rec of State.sessionRecords().values()) rec.session.dispose();
  State.resetAppState();
  Reflect.deleteProperty(navigator as unknown as Record<string, unknown>, 'usb');
});

describe('bootReal — adopt-all-granted-devices loop', () => {
  it('single granted device: adopts and activates it, sets lastSerial, starts loops (byte-identical to single-device boot)', async () => {
    fakeUsb.granted = [usbDeviceFromMock(new MockTransport({ platform: 'rp2350', serial: 'SOLO' }), { serial: 'SOLO' })];

    await Boot.bootReal();

    const rec = State.recordBySerial('SOLO')!;
    expect(State.activeRecord()?.id).toBe(rec.id);
    expect(rec.loops).not.toBeNull();
    expect(State.settings.lastSerial).toBe('SOLO');
    expect(State.connection.phase).toBe('ready');
  });

  it('is a no-op with no granted devices', async () => {
    fakeUsb.granted = [];
    await Boot.bootReal();
    expect(State.connection.phase).toBe('noDevice');
    expect(State.sessionRecords().size).toBe(0);
  });

  it('adopts both granted devices; the first is active, the second dormant with no loops', async () => {
    fakeUsb.granted = [
      usbDeviceFromMock(new MockTransport({ platform: 'rp2350', serial: 'AAA' }), { serial: 'AAA' }),
      usbDeviceFromMock(new MockTransport({ platform: 'rp2350', serial: 'BBB' }), { serial: 'BBB' }),
    ];

    await Boot.bootReal();

    expect(State.sessionRecords().size).toBe(2);
    const a = State.recordBySerial('AAA')!;
    const b = State.recordBySerial('BBB')!;
    expect(State.activeRecord()?.id).toBe(a.id);
    expect(a.loops).not.toBeNull();
    expect(b.loops).toBeNull();
  });

  it('activates the record named by settings.lastSerial when it differs from the first-adopted device', async () => {
    State.settings.lastSerial = 'BBB';
    fakeUsb.granted = [
      usbDeviceFromMock(new MockTransport({ platform: 'rp2350', serial: 'AAA' }), { serial: 'AAA' }),
      usbDeviceFromMock(new MockTransport({ platform: 'rp2350', serial: 'BBB' }), { serial: 'BBB' }),
    ];

    await Boot.bootReal();

    const a = State.recordBySerial('AAA')!;
    const b = State.recordBySerial('BBB')!;
    expect(State.activeRecord()?.id).toBe(b.id);
    expect(a.loops).toBeNull();
    expect(b.loops).not.toBeNull();
  });

  it('keeps the working device active when another granted device fails to open, with no errored attempt visible, and records a badge for the straggler', async () => {
    fakeUsb.granted = [
      usbDeviceFromMock(new MockTransport({ platform: 'rp2350', serial: 'AAA' }), { serial: 'AAA' }),
      failingUsbDevice('BBB'),
    ];

    await Boot.bootReal();

    expect(State.sessionRecords().size).toBe(1);
    const a = State.recordBySerial('AAA')!;
    expect(State.activeRecord()?.id).toBe(a.id);
    expect(a.loops).not.toBeNull();
    expect(State.connection.phase).toBe('ready');
    expect(State.adoptFailures().has('BBB')).toBe(true);
    expect(State.adoptFailures().get('BBB')?.message).toBeTruthy();
  });

  it('activates the first device that actually adopts even when an earlier device in the list failed', async () => {
    fakeUsb.granted = [
      failingUsbDevice('AAA'),
      usbDeviceFromMock(new MockTransport({ platform: 'rp2350', serial: 'BBB' }), { serial: 'BBB' }),
    ];

    await Boot.bootReal();

    expect(State.sessionRecords().size).toBe(1);
    const b = State.recordBySerial('BBB')!;
    expect(State.activeRecord()?.id).toBe(b.id);
    expect(b.loops).not.toBeNull();
    expect(State.connection.phase).toBe('ready');
  });

  it('paints the errored hero only when every granted device fails to adopt, recording no badges', async () => {
    fakeUsb.granted = [failingUsbDevice('AAA'), failingUsbDevice('BBB')];

    await Boot.bootReal();

    expect(State.sessionRecords().size).toBe(0);
    expect(State.connection.phase).toBe('errored');
    expect(State.adoptFailures().size).toBe(0);
  });
});

describe('connectRequested — picker-first duplicate-serial guard', () => {
  it('activates the existing session instead of claiming the interface a second time', async () => {
    await Boot.bootMock('rp2350', { serial: 'DUP' });
    const existing = State.activeRecord()!;
    await Boot.bootMock('rp2350', { serial: 'OTHER' });   // now dormant/active swap target
    expect(State.activeRecord()?.id).not.toBe(existing.id);

    const open = vi.fn(async () => {});
    const claimInterface = vi.fn(async () => {});
    fakeUsb.nextPicked = {
      vendorId: 0x2E8B, productId: 0xFEAA, serialNumber: 'DUP', open, claimInterface,
    } as unknown as USBDevice;

    await Boot.connectRequested();

    expect(State.activeRecord()?.id).toBe(existing.id);
    expect(State.sessionRecords().size).toBe(2);   // no third record created
    expect(open).not.toHaveBeenCalled();
    expect(claimInterface).not.toHaveBeenCalled();
  });

  it('reports the errored attempt when the picker is cancelled, as today', async () => {
    fakeUsb.nextPicked = null;

    await expect(Boot.connectRequested()).rejects.toThrow();

    expect(State.connection.phase).toBe('errored');
    expect(State.sessionRecords().size).toBe(0);
  });

  it('does not open the picker while the active device is shared', async () => {
    await Boot.bootMock('rp2350', { serial: 'AAA' });
    const shared = State.activeRecord()!;
    State.setShareState('sharing');
    const requestDevice = vi.spyOn(fakeUsb, 'requestDevice');

    await Boot.connectRequested();

    expect(requestDevice).not.toHaveBeenCalled();
    expect(State.activeRecord()?.id).toBe(shared.id);
    State.resetRemoteState();
  });

  it('does nothing while an adoption attempt is already in flight', async () => {
    State.dispatch({ t: 'requested', id: State.mintConnId() });
    const requestDevice = vi.spyOn(fakeUsb, 'requestDevice');

    await Boot.connectRequested();

    expect(requestDevice).not.toHaveBeenCalled();
    expect(State.sessionRecords().size).toBe(0);
  });
});

describe('connectRequested — badge recording while a device is live', () => {
  it('records a badge for the picked serial when adoption fails after the picker, leaving the live device active', async () => {
    await Boot.bootMock('rp2350', { serial: 'LIVE' });
    fakeUsb.nextPicked = failingUsbDevice('BADPICK');

    await expect(Boot.connectRequested()).rejects.toThrow();

    expect(State.connection.phase).toBe('ready');
    expect(State.activeRecord()?.session.info.serial).toBe('LIVE');
    expect(State.adoptFailures().has('BADPICK')).toBe(true);
    expect(State.adoptFailures().get('BADPICK')?.message).toBeTruthy();
  });

  it('records no badge when the picker is cancelled while a device is live', async () => {
    await Boot.bootMock('rp2350', { serial: 'LIVE' });
    fakeUsb.nextPicked = null;

    await expect(Boot.connectRequested()).rejects.toThrow();

    expect(State.connection.phase).toBe('ready');
    expect(State.adoptFailures().size).toBe(0);
  });

  it('falls back to an error notice when the picked device carries no serial to key a badge by', async () => {
    State.clearNotices();
    await Boot.bootMock('rp2350', { serial: 'LIVE' });
    const anon = failingUsbDevice('IGNORED');
    Reflect.set(anon as unknown as Record<string, unknown>, 'serialNumber', undefined);
    fakeUsb.nextPicked = anon;

    await expect(Boot.connectRequested()).rejects.toThrow();

    expect(State.connection.phase).toBe('ready');
    expect(State.adoptFailures().size).toBe(0);
    expect(State.notices.list.some((n) => n.kind === 'error')).toBe(true);
    State.clearNotices();
  });
});

describe('registerNavigatorReconnect — grant-is-the-policy adoption', () => {
  it('ignores a re-plug of a device this origin was never granted (foreign vendor id)', () => {
    Boot.registerNavigatorReconnect();
    const foreign = usbDeviceFromMock(new MockTransport({ platform: 'rp2350', serial: 'X' }), { serial: 'X', vendorId: 0x1234 });

    fakeUsb.fire('connect', foreign);

    expect(State.sessionRecords().size).toBe(0);
  });

  it('ignores a replug of a serial that is already adopted', async () => {
    await Boot.bootMock('rp2350', { serial: 'ABC' });
    Boot.registerNavigatorReconnect();
    const replug = usbDeviceFromMock(new MockTransport({ platform: 'rp2350', serial: 'ABC' }), { serial: 'ABC' });

    fakeUsb.fire('connect', replug);
    await Promise.resolve();

    expect(State.sessionRecords().size).toBe(1);
  });

  it('ignores a replug while an adoption attempt is already in flight', async () => {
    Boot.registerNavigatorReconnect();
    State.dispatch({ t: 'requested', id: State.mintConnId() });
    const unknown = usbDeviceFromMock(new MockTransport({ platform: 'rp2350', serial: 'NEW' }), { serial: 'NEW' });

    fakeUsb.fire('connect', unknown);
    await Promise.resolve();

    expect(State.sessionRecords().size).toBe(0);
  });

  it('adopts an unknown granted device and activates it while idle', async () => {
    Boot.registerNavigatorReconnect();
    const solo = usbDeviceFromMock(new MockTransport({ platform: 'rp2350', serial: 'SOLO' }), { serial: 'SOLO' });

    fakeUsb.fire('connect', solo);
    await vi.waitFor(() => expect(State.sessionRecords().size).toBe(1));

    const rec = State.recordBySerial('SOLO')!;
    expect(State.activeRecord()?.id).toBe(rec.id);
    expect(rec.loops).not.toBeNull();
  });

  it('adopts an unknown granted device dormant, never stealing focus from the active device', async () => {
    await Boot.bootMock('rp2350', { serial: 'ACTIVE' });
    Boot.registerNavigatorReconnect();
    const other = usbDeviceFromMock(new MockTransport({ platform: 'rp2350', serial: 'OTHER' }), { serial: 'OTHER' });

    fakeUsb.fire('connect', other);
    await vi.waitFor(() => expect(State.sessionRecords().size).toBe(2));

    const active = State.recordBySerial('ACTIVE')!;
    const dormant = State.recordBySerial('OTHER')!;
    expect(State.activeRecord()?.id).toBe(active.id);
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
    Boot.registerNavigatorReconnect();
    fakeUsb.fire('connect', claimFailingUsbDevice('BUSY'));

    await vi.waitFor(() => expect(State.connection.phase).toBe('errored'));
    expect(State.connection.errorKind).toBe('device-in-use');
    expect(State.sessionRecords().size).toBe(0);
  });

  it('a replug that fails while another device is live stays silent', async () => {
    fakeUsb.granted = [usbDeviceFromMock(new MockTransport({ platform: 'rp2350', serial: 'LIVE' }), { serial: 'LIVE' })];
    await Boot.bootReal();
    expect(State.connection.phase).toBe('ready');

    Boot.registerNavigatorReconnect();
    fakeUsb.fire('connect', claimFailingUsbDevice('BUSY'));
    await new Promise((r) => setTimeout(r, 25));

    expect(State.connection.phase).toBe('ready');
    expect(State.connection.error).toBeNull();
    expect(State.recordBySerial('BUSY')).toBeNull();
    expect(State.activeRecord()?.session.info.serial).toBe('LIVE');
  });
});

describe('bootMockFleet', () => {
  it('boots one device per profile: first active, rest dormant, distinct serials', async () => {
    await Boot.bootMockFleet([
      { name: 'latest', platform: 'rp2350', opts: {} },
      { name: 'floor', platform: 'rp2040', opts: { wireVersion: 28 } },
    ]);

    expect(State.sessionRecords().size).toBe(2);
    const first = State.recordBySerial('MOCK-RP2350-1')!;
    const second = State.recordBySerial('MOCK-RP2040-2')!;
    expect(State.activeRecord()?.id).toBe(first.id);
    expect(first.loops).not.toBeNull();
    expect(second.loops).toBeNull();
  });

  it('a single profile keeps the plain bootMock behavior (default serial, active)', async () => {
    await Boot.bootMockFleet([{ name: 'latest', platform: 'rp2350', opts: {} }]);

    expect(State.sessionRecords().size).toBe(1);
    expect(State.activeRecord()?.loops).not.toBeNull();
    expect(State.activeRecord()?.session.info.serial).not.toContain('MOCK-RP2350-1');
  });
});

describe('badge lifecycle: a successful re-adoption clears its serial\'s badge', () => {
  it('clears the badge once the same serial adopts successfully', async () => {
    State.noteAdoptFailure({ serial: 'RETRY', message: 'boot adoption failed', errorKind: null });
    expect(State.adoptFailures().has('RETRY')).toBe(true);

    await Boot.bootMock('rp2350', { serial: 'RETRY' });

    expect(State.adoptFailures().has('RETRY')).toBe(false);
  });
});
