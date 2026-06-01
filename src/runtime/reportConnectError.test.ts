import { describe, it, expect, beforeEach } from 'vitest';
import { reportConnectError } from './session';
import { UnsupportedFirmware, UnsupportedDevicePacket } from '@/device/DspDevice';
import { session, setStatus } from '@/state';

beforeEach(() => setStatus('idle'));

describe('reportConnectError', () => {
  it('flags an UnsupportedFirmware error so the UI can show the upgrade prompt', () => {
    reportConnectError(new UnsupportedFirmware('1.1.2'));
    expect(session.status).toBe('error');
    expect(session.errorKind).toBe('unsupported-firmware');
    expect(session.error).toContain('1.1.2');
  });

  it('flags an UnsupportedDevicePacket (truncated payload) for the same upgrade prompt', () => {
    reportConnectError(new UnsupportedDevicePacket('1.1.4', 2848, 2896));
    expect(session.status).toBe('error');
    expect(session.errorKind).toBe('unsupported-firmware');
    expect(session.error).toContain('incomplete parameter packet');
  });

  it('leaves an ordinary error unclassified', () => {
    reportConnectError(new Error('usb pipe broken'));
    expect(session.status).toBe('error');
    expect(session.errorKind).toBeNull();
    expect(session.error).toBe('usb pipe broken');
  });
});
