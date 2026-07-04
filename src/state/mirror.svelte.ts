// Per-session device-state store. Two reactive cells:
//   - current   -- our belief of device RAM; mutates on every user write.
//   - baseline  -- what `current` was at the last preset save/load (or connect),
//                 pinned until a baseline refresh; presetsDirty diffs against it.
// Plus the reconcile-intent flags that drive the background param poll, and the
// preset-op guard that suppresses the NotifyChannel's self-echo reconciles
// during a console-initiated preset transition. Write-in-flight bookkeeping
// (the UI dirty dot, the reconcile gate) lives on WriteCoordinator.busy, not
// here -- see src/runtime/writes.svelte.ts.

import type { DspSnapshot } from '@/domain';

export class MirrorState {
  current = $state<DspSnapshot | null>(null);
  baseline = $state<DspSnapshot | null>(null);
  reconcileWanted = $state(false);
  reconcileEager = $state(false);
  // Non-reactive: only the poll loop reads these.
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
    this.presetGuardDepth = 0;
    this.presetGuardUntilMs = 0;
  }
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
  beginPresetGuard(): void { this.presetGuardDepth += 1; }
  endPresetGuard(trailingMs: number, now: number = performance.now()): void {
    if (this.presetGuardDepth > 0) this.presetGuardDepth -= 1;
    if (this.presetGuardDepth === 0) this.presetGuardUntilMs = now + trailingMs;
  }
  presetGuardActive(now: number = performance.now()): boolean {
    return this.presetGuardDepth > 0 || now < this.presetGuardUntilMs;
  }
}
