// Per-session device-state store. Two reactive cells:
//   - current   -- our belief of device RAM; mutates on every user write.
//   - baseline  -- what `current` was at the last preset save/load (or connect),
//                 pinned until a baseline refresh; presetsDirty diffs against it.
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

  // Non-null live snapshot for actions, which run only between sync and dispose.
  // Lets callers drop per-call null guards; throws if read before sync (a bug).
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
