import { SvelteSet } from 'svelte/reactivity';
import { type DspSnapshot } from '@/domain';

// Device-state truth lives in two cells: `live` (our belief of device RAM)
// and `shadow` (the dirty-diff baseline). The wire packet now lives inside
// the device (DspDevice retains it), so the store no longer mirrors it. The
// public verbs each write a fixed subset - keep this matrix in sync when
// adding one:
//
//   verb                  | live | shadow
//   ----------------------|------|--------
//   applyBaselineSnapshot |  x   |   x
//   applyLiveSnapshot     |  x   |   —
//   refreshShadowFromLive |  —   | x(live)
//   patchSnapshot         | x(ip)|   —
//   resetDsp              | null |  kept
//
// Bulk-flush coordination (the rev counters and in-flight send tracking) now
// lives in src/runtime/commit.ts — the state layer no longer owns it, since
// state must not import the runtime layer.
export interface DspState {
  // Our belief about device RAM. Mutates on every user write; reset to null
  live: DspSnapshot | null;

  // The dirty-diff baseline: snapshot of what `live` looked like at the
  // last preset save/load (or initial connect). Stays pinned until an
  // explicit baseline-refresh moment — does NOT auto-update on resync.
  // The preset-dirty getter compares `live` against `shadow` to decide
  // whether the active preset has unsaved edits. Survives disconnect so
  // an eventual offline view can render the last-known-good state.
  shadow: DspSnapshot | null;

  // Pending optimistic writes scheduled by src/runtime/commands.ts.
  // Each in-flight command holds a Symbol token; isInFlight observes
  // the set's reactivity to drive the UI dirty indicator.
  pendingWrites: SvelteSet<symbol>;
}

// Class-based state: $state is deeply reactive, for objects we mutate
// in-place like DspSnapshot. The DspState interface is satisfied in full;
// callers are unchanged.
class DspStateImpl implements DspState {
  live = $state<DspSnapshot | null>(null);
  shadow = $state<DspSnapshot | null>(null);
  pendingWrites = $state(new SvelteSet<symbol>());
}

export const dsp: DspState = new DspStateImpl();

// Reactive: read `isInFlight.current` from a Svelte template, $derived,
// or $effect. True while any mutation has an unconfirmed optimistic
// patch in flight or queued in a coalescer. Drives the dirty-state UI dot.
export const isInFlight = {
  get current(): boolean {
    return dsp.pendingWrites.size > 0;
  },
};

// These two entry points are the ONLY way to push device state into the
// store. The device owns the wire packet now (getSnapshot retains it), so the
// store works purely in domain snapshots.

// Full baseline: live + shadow from one snapshot. Deep-copy into shadow so
// patchSnapshot's in-place edits to live cannot leak into the dirty baseline.
function applyBaseline(snapshot: DspSnapshot): void {
  dsp.live = snapshot;
  dsp.shadow = structuredClone(snapshot);
}
// Apply a fresh snapshot as a new baseline (live + shadow). The device owns
// the wire packet now (getSnapshot retains it), so no wire base is passed.
export function applyBaselineSnapshot(snapshot: DspSnapshot): void {
  applyBaseline(snapshot);
}
// Live-only refresh: advance live, leave shadow (the dirty baseline) pinned.
export function applyLiveSnapshot(snapshot: DspSnapshot): void {
  dsp.live = snapshot;
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

// Copy current live > shadow. Used after PresetSave(active): RAM didn't
// change but the dirty-diff baseline must advance so the just-saved state
// is no longer "dirty". No-op when live is null (disconnected).
// $state.snapshot() is the correct primitive for cloning *out of* the
// reactive system: it strips proxies and returns a plain-object deep copy
// without a second traversal. Contrast with applyBaseline's structuredClone,
// which clones *into* the reactive system from a plain input - the opposite
// direction.
export function refreshShadowFromLive(): void {
  if (!dsp.live) return;
  dsp.shadow = $state.snapshot(dsp.live) as unknown as DspSnapshot;
}
