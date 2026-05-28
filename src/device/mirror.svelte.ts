// Phase B façade over state/dsp.svelte.ts. Phase D will collapse the two
// cells (draft + saved) into a single $state cell here and delete the
// verb matrix in dsp.svelte.ts. During Phase B, consumers can migrate to
// this API without rewriting every component binding — internal
// delegation keeps behavior identical.

import {
  dsp,
  applyBaselineSnapshot,
  refreshSavedFromDraft,
  resetDsp,
} from '@/state';
import type { DspSnapshot } from '@/domain';

// Inflight count: replaces dsp.pendingWrites (a SvelteSet of Symbols).
// A simple counter is enough — UI only reads "is anything in flight."
let _inflight = $state(0);

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

// Read-side façade. Consumers migrate from `dsp.draft` to `mirror.current`
// over time; Phase D will make these the *only* read path.
export const mirror = {
  get current(): DspSnapshot | null { return dsp.draft; },
};

export const presetBaseline = {
  get current(): DspSnapshot | null { return dsp.saved; },
};

// Backwards-compatible alias: `import * as ns` consumers use `ns.current`
// as a wrapper object; call `ns.current.current` to get the live snapshot.
export const current = mirror;

// Initialize the mirror from a fresh device snapshot. Used on connect and
// preset transitions. Delegates to applyBaselineSnapshot so draft + saved
// move together atomically.
export function init(snap: DspSnapshot): void {
  applyBaselineSnapshot(snap);
}

// Capture the current mirror as the new preset baseline. Used after a
// preset save where RAM didn't change but "modified-since-save" must reset.
export function captureBaseline(): void {
  refreshSavedFromDraft();
}

// Clear the mirror on disconnect. Preserves baseline (last-known-good).
export function reset(): void {
  resetDsp();
}
