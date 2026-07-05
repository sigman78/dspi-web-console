import type { DspDevice, DspDeviceInfo } from '@/device/DspDevice';
import type { DeviceState } from '@/protocol/snapshotCodec';
import type { HardwareProfile, PresetSlot } from '@/domain';
import type { StatusStore } from './telemetry.svelte';
import type { PresetsState } from './presets.svelte';
import type { CtrlIfacesState } from './ctrlIfaces.svelte';
import type { ControlSurfacesState } from './controlSurfaces.svelte';
import type { StagingState } from './staging.svelte';
import type { MirrorState } from './mirror.svelte';
import type { LinkHealth } from './linkHealth.svelte';
import type { WriteCoordinator } from '@/runtime/writes.svelte';
import type { NotifyWaiters } from '@/runtime/notifyWaiters';
import type { CommandQueue } from '@/runtime/commandQueue';

export interface PresetClipboard {
  slot: PresetSlot;
  name: string;
  blob: DeviceState;
}

// A bound device plus its per-device runtime state (mirror, presets, telemetry,
// writes, lifecycle guard).
export interface ReadySession {
  readonly device: DspDevice;
  readonly info: DspDeviceInfo;
  readonly hardware: HardwareProfile;
  // The owning connection's abort signal. `alive` is a getter over it, so
  // there is exactly one source of truth for "is this connection still live".
  readonly signal: AbortSignal;
  // Preset clipboard, owned by this device session. Content is snapshotted at
  // copy time (the copy precondition guarantees RAM == flash[slot] just then),
  // so the held blob is immutable: later edits, preset switches, or source
  // slot deletion can't invalidate it. slot/name are display hints only.
  readonly copySource: { held: PresetClipboard | null };
  readonly telemetry: StatusStore;
  readonly presets: PresetsState;
  // V16-only (capabilities.features.controlInterfaces); stays all-null on V10.
  readonly ctrlIfaces: CtrlIfacesState;
  // V16-only (capabilities.features.controlSurfaces); stays all-null on V10.
  readonly controlSurfaces: ControlSurfacesState;
  // Pending heavy device-config edits (input source, I2S/S/PDIF pins, MCK/BCK,
  // output type), staged here until PendingChangesBar's APPLY commits them.
  readonly staging: StagingState;
  readonly mirror: MirrorState;
  readonly health: LinkHealth;
  readonly writes: WriteCoordinator;
  readonly notifyWaiters: NotifyWaiters;
  // Serializes every device control-transfer send for this session -- a
  // snapshot fetch can never interleave with a write mid-flight.
  readonly queue: CommandQueue;
  // Lifecycle guard: a write that settles after dispose() is dropped.
  readonly alive: boolean;
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
  | { t: 'synced';       session: ReadySession }
  | { t: 'failed';       message: string; errorKind?: SessionErrorKind }
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

// Provenance is structural, not stamped: a superseded connection's
// ConnectionScope was aborted, which tears down its transport listeners and
// session before any of its dispatch sites can fire. What used to be an
// attempt-token check at dispatch time is now a `scope.aborted` check at
// each call site in deviceService/boot/linkProbe -- dispatch itself no longer
// filters anything.
export function dispatch(event: AppEvent): void {
  _app = transition(_app, event);
}
