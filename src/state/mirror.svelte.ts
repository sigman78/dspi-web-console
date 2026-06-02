// Primary device-state store. Two reactive cells:
//   - mirror.current     — our belief of device RAM. Mutates on every user
//                          write; cleared on disconnect.
//   - presetBaseline     — what `current` looked like at the last preset
//                          save/load (or connect). Pinned until a baseline
//                          refresh; presetsDirty compares current against it.
// Plus an inflight counter that gates the UI dirty dot and the resync soft-skip.

import type { DspSnapshot } from '@/domain';

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

// Module singleton — exports delegate here for now; Task 3 swaps this for the
// active session's mirror.
const _mirror = new MirrorState();

export const mirror = {
  get current(): DspSnapshot | null { return _mirror.current; },
  init(snap: DspSnapshot): void { _mirror.init(snap); },
  replaceCurrent(snap: DspSnapshot): void { _mirror.replaceCurrent(snap); },
  captureBaseline(): void { _mirror.captureBaseline(); },
  reset(): void { _mirror.reset(); },
};
export const presetBaseline = { get current(): DspSnapshot | null { return _mirror.baseline; } };
export const inflight = { get current(): number { return _mirror.inflight; } };
export const isInFlight = { get current(): boolean { return _mirror.inflight > 0; } };

export function bumpInflight(): void { _mirror.bumpInflight(); }
export function dropInflight(): void { _mirror.dropInflight(); }
export function noteWriteActivity(): void { _mirror.noteWriteActivity(); }
export function lastWriteMs(): number { return _mirror.lastWriteMs; }
export function requestReconcile(eager: boolean): void { _mirror.requestReconcile(eager); }
export function peekReconcile(): { wanted: boolean; eager: boolean } { return _mirror.peekReconcile(); }
export function consumeReconcile(): { wanted: boolean; eager: boolean } { return _mirror.consumeReconcile(); }
export function beginPresetGuard(): void { _mirror.beginPresetGuard(); }
export function endPresetGuard(trailingMs: number, now?: number): void { _mirror.endPresetGuard(trailingMs, now); }
export function presetGuardActive(now?: number): boolean { return _mirror.presetGuardActive(now); }
