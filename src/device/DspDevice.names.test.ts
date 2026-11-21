// Input source and board names (0x54-0x57). Older firmware reuses these
// opcodes for a legacy gain/mute, so the SET side must never fire unless the
// matching 32-byte GET probe passed.

import { describe, it, expect, vi } from 'vitest';
import { MockTransport, type MockOptions } from '@/transport/MockTransport';
import { DspDevice } from './DspDevice';
import * as Protocol from '@/protocol';
import * as Domain from '@/domain';
import { TimeoutError } from '@/transport/withTimeout';

const NAME_OPCODES = [0x54, 0x56];

async function open(opts: Partial<MockOptions> = {}) {
  const mock = new MockTransport({ platform: 'rp2350', wireVersion: Protocol.Wire.MAX_WIRE_VERSION, fw116Release: true, ...opts });
  const ctrlOut = vi.spyOn(mock, 'ctrlOut');
  const device = await DspDevice.create(mock);
  const nameWrites = () => ctrlOut.mock.calls.filter(([req]) => NAME_OPCODES.includes(req));
  return { mock, device, nameWrites };
}

describe('legacy firmware (0x55 answers 4 B, 0x57 answers 1 B)', () => {
  it('fails both probes and refuses every name write without sending anything', async () => {
    const { device, nameWrites } = await open({ fw116Release: false });
    expect(await device.probeInputSourceNames()).toBe(false);
    expect(await device.probeDeviceName()).toBe(false);
    await expect(device.setInputSourceName(Domain.AudioInputSource.Spdif, 'TV')).rejects.toThrow();
    await expect(device.setDeviceName('Den')).rejects.toThrow();
    expect(nameWrites()).toHaveLength(0);
  });

  it('refuses writes before any probe ran', async () => {
    const { device, nameWrites } = await open({ fw116Release: true });
    await expect(device.setDeviceName('Den')).rejects.toThrow();
    await expect(device.setInputSourceName(0, 'TV')).rejects.toThrow();
    expect(nameWrites()).toHaveLength(0);
  });
});

describe('firmware with source names but no board-name support', () => {
  it('passes only the source probe, so only source writes go out', async () => {
    const { device, nameWrites } = await open({ deviceName: false });
    expect(await device.probeInputSourceNames()).toBe(true);
    expect(await device.probeDeviceName()).toBe(false);
    await device.setInputSourceName(Domain.AudioInputSource.I2s, 'DAC');
    await expect(device.setDeviceName('Den')).rejects.toThrow();
    expect(nameWrites().map(([req]) => req)).toEqual([0x54]);
  });
});

describe('probe timeouts', () => {
  it('retries a timeout once; a second one propagates and leaves writes refused', async () => {
    const { mock, device, nameWrites } = await open();
    const real = mock.ctrlIn.bind(mock);
    let failures = 1;
    vi.spyOn(mock, 'ctrlIn').mockImplementation(async (req, val, len) => {
      if (req === 0x55 && failures-- > 0) throw new TimeoutError('ctrlIn', 2000);
      return real(req, val, len);
    });
    expect(await device.probeInputSourceNames()).toBe(true);

    failures = 2;
    await expect(device.probeInputSourceNames()).rejects.toBeInstanceOf(TimeoutError);
    await expect(device.setInputSourceName(1, 'TV')).rejects.toThrow();
    expect(nameWrites()).toHaveLength(0);
  });
});

describe('release firmware', () => {
  it('round-trips a source name, sanitized to printable ASCII and capped at 31', async () => {
    const { device } = await open();
    await device.probeInputSourceNames();
    expect(await device.setInputSourceName(Domain.AudioInputSource.Spdif2, 'Café\tTV')).toBe('CafTV');
    expect(await device.getInputSourceName(Domain.AudioInputSource.Spdif2)).toBe('CafTV');
    const long = 'x'.repeat(40);
    expect(await device.setInputSourceName(Domain.AudioInputSource.Usb, long)).toHaveLength(31);
    expect(await device.getInputSourceName(Domain.AudioInputSource.Usb)).toBe('x'.repeat(31));
  });

  it('clears a name with an empty string', async () => {
    const { device } = await open({ initialInputSourceNames: { 1: 'TV' }, initialDeviceName: 'Den' });
    await device.probeInputSourceNames();
    await device.probeDeviceName();
    expect(await device.getInputSourceName(1)).toBe('TV');
    await device.setInputSourceName(1, '');
    await device.setDeviceName('');
    expect(await device.getInputSourceName(1)).toBe('');
    expect(await device.getDeviceName()).toBe('');
  });

  it('round-trips the board name independently of source names', async () => {
    const { device } = await open();
    await device.probeDeviceName();
    await device.setDeviceName('Rack left');
    expect(await device.getDeviceName()).toBe('Rack left');
    expect(await device.getInputSourceName(0)).toBe('');
  });
});
