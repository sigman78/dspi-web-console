// Primary device-state store. Two reactive cells:
//   - mirror.current     — our belief of device RAM. Mutates on every user
//                          write; cleared on disconnect.
//   - presetBaseline     — what `current` looked like at the last preset
//                          save/load (or connect). Pinned until a baseline
//                          refresh; presetsDirty compares current against it.
// Plus an inflight counter that gates the UI dirty dot and the resync soft-skip.

import type { DspSnapshot } from '@/domain';

let _current = $state<DspSnapshot | null>(null);
let _baseline = $state<DspSnapshot | null>(null);
let _inflight = $state(0);

// Reconcile request flags. A write/scrub success sets _reconcileWanted; the
// background param poll consumes it when inflight === 0. _reconcileEager asks
// the poll to skip its interval gate and run at the next tick (still
// inflight-gated, so it never clobbers an in-flight drag). Eager is sticky
// against a later non-eager request within the same pending window.
let _reconcileWanted = $state(false);
let _reconcileEager = $state(false);

export const mirror = {
  get current(): DspSnapshot | null { return _current; },

  // Atomic baseline: set current AND baseline from one snapshot. Baseline is
  // a deep clone so subsequent in-place edits to current can't leak into it.
  // Used on connect and preset transitions (Load / Paste / Revert).
  init(snap: DspSnapshot): void {
    _current = snap;
    _baseline = structuredClone(snap);
  },

  // Current-only refresh: advance current, leave baseline pinned. Used by
  // forceResyncNow after a failed write — the user's pre-failure edits stay
  // "dirty against the preset", which is the correct semantic.
  replaceCurrent(snap: DspSnapshot): void {
    _current = snap;
  },

  // Refresh baseline from current. Used after PresetSave(active): device RAM
  // didn't change but the dirty-diff origin must advance. $state.snapshot()
  // clones out of the reactive system; storing it back into _baseline (which
  // is a $state cell) re-wraps it. No-op when current is null.
  captureBaseline(): void {
    if (!_current) return;
    _baseline = $state.snapshot(_current) as DspSnapshot;
  },

  // Clear the live cell on disconnect. Baseline is intentionally preserved so
  // a future feature can render last-known-good while offline; today the UI
  // just shows the empty state, but the invariant is worth keeping.
  reset(): void {
    _current = null;
    _reconcileWanted = false;
    _reconcileEager = false;
  },
};

// Mark that device state should be reconciled by the next eligible param poll.
// `eager` is OR-accumulated: once a pending window is eager, a later non-eager
// request can't downgrade it.
export function requestReconcile(eager: boolean): void {
  _reconcileWanted = true;
  if (eager) _reconcileEager = true;
}

// Read the pending reconcile flags without clearing. The param poll peeks to
// decide whether to run (so a skipped tick leaves the request pending), then
// consumes only when it commits to a reconcile.
export function peekReconcile(): { wanted: boolean; eager: boolean } {
  return { wanted: _reconcileWanted, eager: _reconcileEager };
}

// Read and clear the pending reconcile flags. Called by the param poll cadence
// once it commits to running a reconcile.
export function consumeReconcile(): { wanted: boolean; eager: boolean } {
  const r = { wanted: _reconcileWanted, eager: _reconcileEager };
  _reconcileWanted = false;
  _reconcileEager = false;
  return r;
}

export const presetBaseline = {
  get current(): DspSnapshot | null { return _baseline; },
};

export const inflight = {
  get current(): number { return _inflight; },
};

export const isInFlight = {
  get current(): boolean { return _inflight > 0; },
};

export function bumpInflight(): void {
  _inflight += 1;
}

export function dropInflight(): void {
  if (_inflight > 0) _inflight -= 1;
}
