import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DspDevice } from './DspDevice';
import * as Domain from '@/domain';
import { openSingleDevice } from '@test/hil/setup';

// Device and input source names (fw 1.1.6 release, 0x54-0x57). Each write is
// read back at once (the firmware returns the staged name before its flash
// write) and the original name is restored afterwards.

describe('DspDevice — device and input source names (HIL, fw 1.1.6)', () => {
  let device: DspDevice;
  let close: () => Promise<void>;
  let sourceNames = false;
  let deviceName = false;

  beforeAll(async () => {
    const opened = await openSingleDevice();
    device = opened.device;
    close = opened.close;
    sourceNames = await device.probeInputSourceNames();
    deviceName = await device.probeDeviceName();
  });

  afterAll(async () => {
    if (close) await close();
  });

  it('board name: write, sanitize, clear, restore', async () => {
    if (!deviceName) return;
    const original = await device.getDeviceName();
    try {
      expect(await device.setDeviceName('HIL Bench')).toBe('HIL Bench');
      expect(await device.getDeviceName()).toBe('HIL Bench');

      const stored = await device.setDeviceName('Café – Rack ' + 'x'.repeat(40));
      expect(stored.length).toBeLessThanOrEqual(31);
      expect(await device.getDeviceName()).toBe(stored);

      await device.setDeviceName('');
      expect(await device.getDeviceName()).toBe('');
    } finally {
      await device.setDeviceName(original);
    }
    expect(await device.getDeviceName()).toBe(original);
  });

  it('input source name: USB round-trips and clears', async () => {
    if (!sourceNames) return;
    const usb = Domain.AudioInputSource.Usb;
    const original = await device.getInputSourceName(usb);
    try {
      expect(await device.setInputSourceName(usb, 'Desk PC')).toBe('Desk PC');
      expect(await device.getInputSourceName(usb)).toBe('Desk PC');

      await device.setInputSourceName(usb, '');
      expect(await device.getInputSourceName(usb)).toBe('');
    } finally {
      await device.setInputSourceName(usb, original);
    }
    expect(await device.getInputSourceName(usb)).toBe(original);
  });
});
