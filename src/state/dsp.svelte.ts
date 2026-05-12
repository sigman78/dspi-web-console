import { SvelteSet } from 'svelte/reactivity';
import type { DspSnapshot } from '../domain/snapshot';

export interface DspState {
  // Our belief about device RAM. Mutates on every user write; reset to
  // null on disconnect.
  live: DspSnapshot | null;

  // Last known good snapshot. Survives disconnect so the UI can render
  // an offline view (banner + disabled controls) when that work lands.
  // Updated only via applyDspSnapshot (full sync / resync); optimistic
  // patches do NOT touch shadow.
  shadow: DspSnapshot | null;

  // Reserved for future SaveParams (0x51) / LoadParams (0x52) firmware
  // workflow. Always null today; populated by saveParams() success and
  // cleared on disconnect once the workflow ships. See docs/DATA-MODEL.md
  // section 11 (Save UX) and section 16 Q3 (populate strategy).
  flashShadow: DspSnapshot | null;

  // Pending optimistic writes scheduled by src/runtime/commands.ts.
  // Each in-flight command holds a Symbol token; isInFlight observes
  // the set's reactivity to drive the UI dirty indicator.
  pendingWrites: SvelteSet<symbol>;
}

export const dsp = $state<DspState>({
  live: null,
  shadow: null,
  flashShadow: null,
  pendingWrites: new SvelteSet(),
});

// Reactive: read `isInFlight.current` from a Svelte template, $derived,
// or $effect. True while any mutation has an unconfirmed optimistic
// patch in flight or queued in a coalescer. Drives the dirty-state UI dot.
export const isInFlight = {
  get current(): boolean {
    return dsp.pendingWrites.size > 0;
  },
};

export function applyDspSnapshot(snapshot: DspSnapshot): void {
  dsp.live = snapshot;
  // Deep copy: patchSnapshot mutates dsp.live in place. A shared
  // reference would let optimistic patches leak into shadow.
  dsp.shadow = structuredClone(snapshot);
}

export function resetDsp(): void {
  dsp.live = null;
  // dsp.shadow intentionally NOT reset -- last known good survives
  // until the next successful sync overwrites it.
  dsp.pendingWrites = new SvelteSet();
}

// Single mutation point for in-place snapshot edits. Both the mutation
// factory and connect-time reconciliation funnel through here so any
// future cross-cutting hooks (undo, change events) have one place to
// attach. patchSnapshot touches `live` only; shadow stays at last sync.
export function patchSnapshot(patch: Partial<DspSnapshot>): void {
  if (dsp.live) Object.assign(dsp.live, patch);
}
