import type { DspDevice, DspDeviceInfo } from '@/device/DspDevice';
import type { HardwareProfile } from '@/domain';

export type SessionStatus = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error';

// Discriminates an 'error' status so the UI can give certain failures a tailored
// treatment (e.g. a firmware-upgrade prompt) instead of the generic diagnostics
// panel. null = an ordinary/unclassified error.
export type SessionErrorKind = null | 'unsupported-firmware';

// lastDeviceInfo is intentionally preserved across disconnect so the UI
// can show the last-known device label until a new device is bound.
// Reconnect-identity matching uses settings.lastSerial, not this field.
export const session = $state<{
  status: SessionStatus;
  error: string | null;
  errorKind: SessionErrorKind;
  device: DspDevice | null;
  lastDeviceInfo: DspDeviceInfo | null;
  hardware: HardwareProfile | null;
}>({
  status: 'idle',
  error: null,
  errorKind: null,
  device: null,
  lastDeviceInfo: null,
  hardware: null,
});

export function setStatus(
  status: SessionStatus,
  error: string | null = null,
  errorKind: SessionErrorKind = null,
): void {
  session.status = status;
  session.error = error;
  session.errorKind = errorKind;
}

export function bindDevice(d: DspDevice | null): void {
  session.device = d;
  if (d == null) {
    session.hardware = null;
  } else {
    session.lastDeviceInfo = d.info;
    session.hardware = d.hardware;
  }
}
