import type { DspDevice, DspDeviceInfo } from '@/device/DspDevice';
import type { HardwareProfile } from '@/domain';
import type { SessionErrorKind } from './session.svelte';

// Minimal in Phase A: wraps the already-bound device. Phase B expands this into
// the owner of mirror/presets/telemetry/scope and the per-session `alive` guard.
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

// The single writer of connection phase. Phase A keeps it event-driven — the next
// state is determined by the event, not guarded against the current state. A
// stricter legal-transition table is a later enhancement.
export function transition(_state: AppState, event: AppEvent): AppState {
  switch (event.t) {
    case 'requested':    return { kind: 'connecting' };
    case 'synced':       return { kind: 'ready', session: event.session };
    case 'failed':       return { kind: 'errored', message: event.message, errorKind: event.errorKind ?? null };
    case 'disconnected': return { kind: 'noDevice' };
  }
}
