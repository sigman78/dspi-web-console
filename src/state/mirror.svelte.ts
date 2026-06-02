// Primary device-state store. Two reactive cells:
//   - mirror.current     — our belief of device RAM. Mutates on every user
//                          write; cleared on disconnect.
//   - presetBaseline     — what `current` looked like at the last preset
//                          save/load (or connect). Pinned until a baseline
//                          refresh; presetsDirty compares current against it.
// Plus an inflight counter that gates the UI dirty dot and the resync soft-skip.

import type { DspSnapshot } from '@/domain';
import { activeSession } from './appState.svelte';

export class MirrorState {
  current = $state<DspSnapshot | null>(null);
  baseline = $state<DspSnapshot | null>(null);
  inflight = $state(0);
  reconcileWanted = $state(false);
  reconcileEager = $state(false);
  // Non-reactive: only the poll loop reads these.
  lastWriteMs = 0;
  presetGuardDepth = 0;
  presetGuardUntilMs = 0;

  // Non-null live snapshot. A ready session's `current` is set at synced and only
  // nulled on dispose (no action runs then), so actions read/mutate via `snapshot`
  // to drop their per-call null guards. Throws if read before sync (a bug).
  get snapshot(): DspSnapshot {
    if (!this.current) throw new Error('MirrorState.snapshot read before a snapshot was set');
    return this.current;
  }

  init(snap: DspSnapshot): void {
    this.current = snap;
    this.baseline = structuredClone(snap);
  }
  replaceCurrent(snap: DspSnapshot): void {
    this.current = snap;
  }
  captureBaseline(): void {
    if (!this.current) return;
    this.baseline = $state.snapshot(this.current) as DspSnapshot;
  }
  reset(): void {
    this.current = null;
    this.reconcileWanted = false;
    this.reconcileEager = false;
    this.lastWriteMs = 0;
    this.presetGuardDepth = 0;
    this.presetGuardUntilMs = 0;
  }
  noteWriteActivity(): void { this.lastWriteMs = performance.now(); }
  requestReconcile(eager: boolean): void {
    this.reconcileWanted = true;
    if (eager) this.reconcileEager = true;
  }
  peekReconcile(): { wanted: boolean; eager: boolean } {
    return { wanted: this.reconcileWanted, eager: this.reconcileEager };
  }
  consumeReconcile(): { wanted: boolean; eager: boolean } {
    const r = { wanted: this.reconcileWanted, eager: this.reconcileEager };
    this.reconcileWanted = false;
    this.reconcileEager = false;
    return r;
  }
  bumpInflight(): void { this.inflight += 1; }
  dropInflight(): void { if (this.inflight > 0) this.inflight -= 1; }
  beginPresetGuard(): void { this.presetGuardDepth += 1; }
  endPresetGuard(trailingMs: number, now: number = performance.now()): void {
    if (this.presetGuardDepth > 0) this.presetGuardDepth -= 1;
    if (this.presetGuardDepth === 0) this.presetGuardUntilMs = now + trailingMs;
  }
  presetGuardActive(now: number = performance.now()): boolean {
    return this.presetGuardDepth > 0 || now < this.presetGuardUntilMs;
  }
}

// Inert fallback so reads while disconnected get null/zero defaults. A stale
// in-flight write/reconcile can land here after disconnect; harmless, since it is
// never read while a session is active and the next connect gets a fresh mirror.
const detached = new MirrorState();

function mst(): MirrorState {
  return activeSession()?.mirror ?? detached;
}

export const mirror = {
  get current(): DspSnapshot | null { return mst().current; },
  init(snap: DspSnapshot): void { mst().init(snap); },
  replaceCurrent(snap: DspSnapshot): void { mst().replaceCurrent(snap); },
  captureBaseline(): void { mst().captureBaseline(); },
  reset(): void { mst().reset(); },
};
export const presetBaseline = { get current(): DspSnapshot | null { return mst().baseline; } };
export const inflight = { get current(): number { return mst().inflight; } };
export const isInFlight = { get current(): boolean { return mst().inflight > 0; } };

export function bumpInflight(): void { mst().bumpInflight(); }
export function dropInflight(): void { mst().dropInflight(); }
export function noteWriteActivity(): void { mst().noteWriteActivity(); }
export function lastWriteMs(): number { return mst().lastWriteMs; }
export function requestReconcile(eager: boolean): void { mst().requestReconcile(eager); }
export function peekReconcile(): { wanted: boolean; eager: boolean } { return mst().peekReconcile(); }
export function consumeReconcile(): { wanted: boolean; eager: boolean } { return mst().consumeReconcile(); }
export function beginPresetGuard(): void { mst().beginPresetGuard(); }
export function endPresetGuard(trailingMs: number, now?: number): void { mst().endPresetGuard(trailingMs, now); }
export function presetGuardActive(now?: number): boolean { return mst().presetGuardActive(now); }
