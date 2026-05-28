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
  },
};

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
