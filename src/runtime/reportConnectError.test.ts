import { describe, it, expect, beforeEach } from 'vitest';
import { reportConnectError } from './session';
import { UnsupportedFirmware, UnsupportedDevicePacket } from '@/device/DspDevice';
import { dispatch, connection } from '@/state';

beforeEach(() => dispatch({ t: 'disconnected' }));

describe('reportConnectError', () => {
  it('flags an UnsupportedFirmware error so the UI can show the upgrade prompt', () => {
    reportConnectError(new UnsupportedFirmware('1.1.2'));
    expect(connection.phase).toBe('errored');
    expect(connection.errorKind).toBe('unsupported-firmware');
    expect(connection.error).toContain('1.1.2');
  });

  it('flags an UnsupportedDevicePacket (truncated payload) for the same upgrade prompt', () => {
    reportConnectError(new UnsupportedDevicePacket('1.1.4', 2848, 2896));
    expect(connection.phase).toBe('errored');
    expect(connection.errorKind).toBe('unsupported-firmware');
    expect(connection.error).toContain('incomplete parameter packet');
  });

  it('leaves an ordinary error unclassified', () => {
    reportConnectError(new Error('usb pipe broken'));
    expect(connection.phase).toBe('errored');
    expect(connection.errorKind).toBeNull();
    expect(connection.error).toBe('usb pipe broken');
  });
});
