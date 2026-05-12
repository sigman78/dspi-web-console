import type { DspDevice } from '../device/DspDevice';
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
  generation: number;
}>({
  status: 'idle',
  error: null,
  device: null,
  identity: { serial: '', firmwareVersion: '', platformType: null },
  generation: 0,
});

export function setStatus(status: SessionStatus, error: string | null = null): void {
  session.status = status;
  session.error = error;
}

export function bindDevice(d: DspDevice | null): void {
  session.device = d;
  session.generation += 1;
}
