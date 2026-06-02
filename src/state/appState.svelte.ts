import type { DspDevice, DspDeviceInfo } from '@/device/DspDevice';
import type { HardwareProfile, PresetSlot } from '@/domain';
import { setStatus, type SessionErrorKind } from './session.svelte';

// Wraps a bound device. Carries device identity only; per-device runtime state
// (mirror, presets, telemetry, scope, lifecycle guard) attaches here as it lands.
export interface ReadySession {
  readonly device: DspDevice;
  readonly info: DspDeviceInfo;
  readonly hardware: HardwareProfile;
  // UI-only preset copy-source slot, owned by this device session.
  readonly copySource: { slot: PresetSlot | null };
}

export function makeReadySession(device: DspDevice): ReadySession {
  const copySource = $state<{ slot: PresetSlot | null }>({ slot: null });
  return { device, info: device.info, hardware: device.hardware, copySource };
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

let _app = $state<AppState>({ kind: 'noDevice' });
// Tracks the active session by plain reference so activeSession() bypasses the
// $state proxy and returns the exact object that was passed to dispatch(synced).
let _session: ReadySession | null = null;

export const app = {
  get current(): AppState { return _app; },
};

export function activeSession(): ReadySession | null {
  return _session;
}

// Legacy projection: keep session.status/error/errorKind in lockstep so existing
// UI and tests are untouched. Driven by the event (not derived from _app) so the
// legacy idle/disconnected distinction the UI still relies on is preserved — both
// collapse to { kind:'noDevice' } in the union.
function applyLegacy(event: AppEvent): void {
  switch (event.t) {
    case 'requested':    setStatus('connecting'); break;
    case 'synced':       setStatus('connected'); break;
    case 'failed':       setStatus('error', event.message, event.errorKind ?? null); break;
    case 'disconnected': setStatus('disconnected'); break;
  }
}

export function dispatch(event: AppEvent): void {
  _app = transition(_app, event);
  if (event.t === 'synced')      _session = event.session;
  else if (event.t !== 'requested') _session = null;
  applyLegacy(event);
}
