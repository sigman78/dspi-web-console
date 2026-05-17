import type { DspDevice, DspDeviceInfo } from '../device/DspDevice';
import type { HardwareProfile } from '../domain';

export type SessionStatus = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error';

// lastDeviceInfo is intentionally preserved across disconnect so the UI
// can show the last-known device label until a new device is bound.
// Reconnect-identity matching uses settings.lastSerial, not this field.
export const session = $state<{
  status: SessionStatus;
  error: string | null;
  device: DspDevice | null;
  lastDeviceInfo: DspDeviceInfo | null;
  hardware: HardwareProfile | null;
  generation: number;
}>({
  status: 'idle',
  error: null,
  device: null,
  lastDeviceInfo: null,
  hardware: null,
  generation: 0,
});

export function setStatus(status: SessionStatus, error: string | null = null): void {
  session.status = status;
  session.error = error;
}

export function bindDevice(d: DspDevice | null): void {
  session.device = d;
  if (d == null) {
    session.hardware = null;
  } else {
    session.lastDeviceInfo = d.info;
    session.hardware = d.hardware;
  }
  session.generation += 1;
}
