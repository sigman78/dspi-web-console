import type { DspDevice, DspDeviceInfo } from '@/device/DspDevice';
import type { HardwareProfile, PresetSlot } from '@/domain';
import type { StatusStore } from './telemetry.svelte';
import type { PresetsState } from './presets.svelte';
import type { MirrorState } from './mirror.svelte';
import type { WriteCoordinator } from '@/runtime/writes';

// A bound device plus its per-device runtime state (mirror, presets, telemetry,
// writes, lifecycle guard).
export interface ReadySession {
  readonly device: DspDevice;
  readonly info: DspDeviceInfo;
  readonly hardware: HardwareProfile;
  // UI-only preset copy-source slot, owned by this device session.
  readonly copySource: { slot: PresetSlot | null };
  readonly telemetry: StatusStore;
  readonly presets: PresetsState;
  readonly mirror: MirrorState;
  readonly writes: WriteCoordinator;
  // Lifecycle guard: a write that settles after dispose() is dropped.
  alive: boolean;
  dispose(): void;
}

// Discriminates an 'error' status so the UI can give certain failures a tailored
// treatment (e.g. a firmware-upgrade prompt). null = ordinary/unclassified error.
export type SessionErrorKind = null | 'unsupported-firmware';

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

// Next state is determined by the event alone; the current state is not
// consulted (no legal-transition guard).
export function transition(_state: AppState, event: AppEvent): AppState {
  switch (event.t) {
    case 'requested':    return { kind: 'connecting' };
    case 'synced':       return { kind: 'ready', session: event.session };
    case 'failed':       return { kind: 'errored', message: event.message, errorKind: event.errorKind ?? null };
    case 'disconnected': return { kind: 'noDevice' };
  }
}

// $state.raw: reactive on reassignment (phase change) but not deep-proxied, so a
// stored ReadySession keeps its identity and its own internal $state cells stay
// the single reactive source for per-field UI.
let _app = $state.raw<AppState>({ kind: 'noDevice' });

export const app = {
  get current(): AppState { return _app; },
};

// Read-only connection state derived from the machine, for UI gating + display.
export const connection = {
  get phase(): AppState['kind'] { return _app.kind; },
  get connected(): boolean { return _app.kind === 'ready'; },
  get error(): string | null { return _app.kind === 'errored' ? _app.message : null; },
  get errorKind(): SessionErrorKind { return _app.kind === 'errored' ? _app.errorKind : null; },
  get label(): string {
    switch (_app.kind) {
      case 'ready':      return 'CONNECTED';
      case 'connecting': return 'CONNECTING';
      case 'errored':    return 'ERROR';
      case 'noDevice':   return 'OFFLINE';
    }
  },
};

export function activeSession(): ReadySession | null {
  return _app.kind === 'ready' ? _app.session : null;
}

export function dispatch(event: AppEvent): void {
  _app = transition(_app, event);
}
