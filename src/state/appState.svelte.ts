import type { DspDevice, DspDeviceInfo } from '@/device/DspDevice';
import type { HardwareProfile } from '@/domain';
import type { SessionErrorKind } from './session.svelte';

// Wraps a bound device. Carries device identity only; per-device runtime state
// (mirror, presets, telemetry, scope, lifecycle guard) attaches here as it lands.
export interface ReadySession {
  readonly device: DspDevice;
  readonly info: DspDeviceInfo;
  readonly hardware: HardwareProfile;
}

export function makeReadySession(device: DspDevice): ReadySession {
  return { device, info: device.info, hardware: device.hardware };
}

export type AppState =
  | { kind: 'noDevice' }
  | { kind: 'connecting' }
  | { kind: 'ready'; session: ReadySession }
  | { kind: 'errored'; message: string; errorKind: SessionErrorKind };

export type AppEvent =
  | { t: 'requested' }
  | { t: 'synced'; session: ReadySession }
  | { t: 'failed'; message: string; errorKind?: SessionErrorKind }
  | { t: 'disconnected' };

// The single writer of connection phase. The next state is determined by the
// event alone; the current state is not consulted (no legal-transition guard).
export function transition(_state: AppState, event: AppEvent): AppState {
  switch (event.t) {
    case 'requested':    return { kind: 'connecting' };
    case 'synced':       return { kind: 'ready', session: event.session };
    case 'failed':       return { kind: 'errored', message: event.message, errorKind: event.errorKind ?? null };
    case 'disconnected': return { kind: 'noDevice' };
  }
}
