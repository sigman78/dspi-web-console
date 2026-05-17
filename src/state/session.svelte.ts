import type { DspDevice } from '../device/DspDevice';
import type { HardwareProfile } from '../domain/hardware';
import type { PlatformType } from '../domain/platform';

export type SessionStatus = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error';

interface Identity {
  serial: string;
  firmwareVersion: string;
  platformType: PlatformType | null;
}

export const session = $state<{
  status: SessionStatus;
  error: string | null;
  device: DspDevice | null;
  identity: Identity;
  hardware: HardwareProfile | null;
  generation: number;
}>({
  status: 'idle',
  error: null,
  device: null,
  identity: { serial: '', firmwareVersion: '', platformType: null },
  hardware: null,
  generation: 0,
});

export function setStatus(status: SessionStatus, error: string | null = null): void {
  session.status = status;
  session.error = error;
}

export function bindDevice(d: DspDevice | null): void {
  session.device = d;
  if (d == null) session.hardware = null;
  session.generation += 1;
}
