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
import type { WireMirror } from '@/runtime/wireMirror';
import { SvelteMap } from 'svelte/reactivity';

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
  // Raw wire-splice buffer for this session's PARAM_CHANGED notifications.
  readonly wireMirror: WireMirror;
  // Lifecycle guard: a write that settles after dispose() is dropped.
  readonly alive: boolean;
  dispose(): void;
}

// Discriminates an 'error' status so the UI can give certain failures a tailored
// treatment (a firmware-upgrade prompt, a device-in-use advisory). null =
// ordinary/unclassified error.
export type SessionErrorKind = null | 'unsupported-firmware' | 'device-in-use';

export type ConnId = number;

// Ready sessions only. `loops` is the running-loop stop handle: non-null iff
// this record's poll/notify/probe loops are running. Mutated by runtime
// activation code (deviceService), never by the reducer.
export interface DeviceRecord {
  readonly id: ConnId;
  readonly session: ReadySession;
  loops: (() => void) | null;
}

// Single-slot connect attempt: adoption is serial (one attempt at a time), so
// connecting/errored never need to be per-record.
export type ConnectAttempt =
  | { kind: 'idle' }
  | { kind: 'connecting'; id: ConnId }
  | { kind: 'errored'; id: ConnId; message: string; errorKind: SessionErrorKind };

export type AppState =
  | { kind: 'noDevice' }
  | { kind: 'connecting' }
  | { kind: 'ready'; session: ReadySession }
  | { kind: 'errored'; message: string; errorKind: SessionErrorKind };

export type AppEvent =
  | { t: 'requested'; id: ConnId }
  // `activate: false` marks a background adoption: it registers dormant
  // unless nothing else is active (the app never ends up with a registry and
  // no active session).
  | { t: 'synced'; id: ConnId; session: ReadySession; activate?: false }
  | { t: 'failed'; id: ConnId; message: string; errorKind?: SessionErrorKind }
  | { t: 'activated'; id: ConnId }
  | { t: 'removed'; id: ConnId };

// Ready sessions, keyed by connection id. svelte/reactivity so a device-list
// UI can render from it directly.
const _sessions = new SvelteMap<ConnId, DeviceRecord>();
let _activeId = $state<ConnId | null>(null);
let _attempt = $state.raw<ConnectAttempt>({ kind: 'idle' });

let _nextId = 1;
export function mintConnId(): ConnId { return _nextId++; }

// Map insertion order tracks adoption order; the last key is the
// most-recently-adopted remaining record.
function mostRecentId(): ConnId | null {
  let last: ConnId | null = null;
  for (const id of _sessions.keys()) last = id;
  return last;
}

// Next state is determined by the event alone; the current registry is
// consulted only to decide whether a late/stale event still applies.
export function dispatch(event: AppEvent): void {
  switch (event.t) {
    case 'requested':
      _attempt = { kind: 'connecting', id: event.id };
      break;
    case 'synced':
      _sessions.set(event.id, { id: event.id, session: event.session, loops: null });
      if (event.activate !== false || _activeId === null) _activeId = event.id;
      if (_attempt.kind !== 'idle' && _attempt.id === event.id) _attempt = { kind: 'idle' };
      break;
    case 'failed':
      // A late failure after synced: the record never should have existed.
      if (_sessions.has(event.id)) {
        _sessions.delete(event.id);
        if (_activeId === event.id) _activeId = mostRecentId();
      }
      // A failure paints the global error state only when no device remains
      // active: a connection dying alongside a still-live device must not
      // cover that device's UI with the error hero.
      if (_activeId === null) {
        _attempt = { kind: 'errored', id: event.id, message: event.message, errorKind: event.errorKind ?? null };
      } else if (_attempt.kind !== 'idle' && _attempt.id === event.id) {
        _attempt = { kind: 'idle' };
      }
      break;
    case 'activated':
      if (_sessions.has(event.id)) _activeId = event.id;
      break;
    case 'removed':
      _sessions.delete(event.id);
      if (_attempt.kind !== 'idle' && _attempt.id === event.id) _attempt = { kind: 'idle' };
      if (_activeId === event.id) _activeId = mostRecentId();
      break;
  }
}

// Derived view over the registry + attempt slot, exposed as the single-slot
// AppState components render from. Ready wins over connecting: an adoption in
// progress must not hide the active device's UI.
const _view = $derived.by((): AppState => {
  const rec = _activeId !== null ? _sessions.get(_activeId) : undefined;
  if (rec) return { kind: 'ready', session: rec.session };
  if (_attempt.kind === 'connecting') return { kind: 'connecting' };
  if (_attempt.kind === 'errored') return { kind: 'errored', message: _attempt.message, errorKind: _attempt.errorKind };
  return { kind: 'noDevice' };
});

export const app = {
  get current(): AppState { return _view; },
};

// Read-only connection state derived from the machine, for UI gating + display.
export const connection = {
  get phase(): AppState['kind'] { return _view.kind; },
  get connected(): boolean { return _view.kind === 'ready'; },
  get error(): string | null { return _view.kind === 'errored' ? _view.message : null; },
  get errorKind(): SessionErrorKind { return _view.kind === 'errored' ? _view.errorKind : null; },
  get label(): string {
    switch (_view.kind) {
      case 'ready':      return 'CONNECTED';
      case 'connecting': return 'CONNECTING';
      case 'errored':    return 'ERROR';
      case 'noDevice':   return 'OFFLINE';
    }
  },
};

export function activeSession(): ReadySession | null {
  const rec = _activeId !== null ? _sessions.get(_activeId) : undefined;
  return rec?.session ?? null;
}

export function sessionRecords(): ReadonlyMap<ConnId, DeviceRecord> {
  return _sessions;
}

export function activeRecord(): DeviceRecord | null {
  const rec = _activeId !== null ? _sessions.get(_activeId) : undefined;
  return rec ?? null;
}

export function recordOf(id: ConnId): DeviceRecord | null {
  return _sessions.get(id) ?? null;
}

// True while an adoption attempt is in flight. `connection.phase` can't answer
// this: it's the ready-wins view, so it reports 'ready' even mid-adoption
// while another device stays active.
export function adoptionInProgress(): boolean {
  return _attempt.kind === 'connecting';
}

export function recordBySerial(serial: string): DeviceRecord | null {
  for (const rec of _sessions.values()) {
    if (rec.session.info.serial === serial) return rec;
  }
  return null;
}

// Test-only: clears the registry and attempt slot without touching any
// session's own resources (callers dispose() sessions themselves first).
export function resetAppState(): void {
  _sessions.clear();
  _activeId = null;
  _attempt = { kind: 'idle' };
}
