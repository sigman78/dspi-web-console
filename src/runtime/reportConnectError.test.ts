import { describe, it, expect, beforeEach } from 'vitest';
import { reportConnectError } from './boot';
import { UnsupportedFirmware, UnsupportedDevicePacket } from '@/device/DspDevice';
import { DeviceInUse } from '@/transport/WebUsbTransport';
import { mintConnId, connection, resetAppState } from '@/state';

beforeEach(() => resetAppState());

describe('reportConnectError', () => {
  it('flags an UnsupportedFirmware error so the UI can show the upgrade prompt', () => {
    reportConnectError(mintConnId(), new UnsupportedFirmware('1.1.2'));
    expect(connection.phase).toBe('errored');
    expect(connection.errorKind).toBe('unsupported-firmware');
    expect(connection.error).toContain('1.1.2');
  });

  it('flags an UnsupportedDevicePacket (truncated payload) for the same upgrade prompt', () => {
    reportConnectError(mintConnId(), new UnsupportedDevicePacket('1.1.4', 2848, 2960));
    expect(connection.phase).toBe('errored');
    expect(connection.errorKind).toBe('unsupported-firmware');
    expect(connection.error).toContain('incomplete parameter packet');
  });

  it('flags a DeviceInUse (claim failure) so the UI can show the in-use advisory', () => {
    reportConnectError(mintConnId(), new DeviceInUse('Unable to claim interface.'));
    expect(connection.phase).toBe('errored');
    expect(connection.errorKind).toBe('device-in-use');
  });

  it('leaves an ordinary error unclassified', () => {
    reportConnectError(mintConnId(), new Error('usb pipe broken'));
    expect(connection.phase).toBe('errored');
    expect(connection.errorKind).toBeNull();
    expect(connection.error).toBe('usb pipe broken');
  });
});
