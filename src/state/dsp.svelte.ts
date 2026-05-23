import { SvelteSet } from 'svelte/reactivity';
import { type DspSnapshot } from '@/domain';

// Device-state truth lives in two cells: `draft` (our belief of device RAM)
// and `saved` (the dirty-diff baseline). The wire packet now lives inside
// the device (DspDevice retains it), so the store no longer mirrors it. The
// public verbs each write a fixed subset - keep this matrix in sync when
// adding one:
//
//   verb                   | draft | saved
//   -----------------------|-------|--------
//   applyBaselineSnapshot  |   x   |   x
//   applyDraftSnapshot     |   x   |   -
//   refreshSavedFromDraft  |   -   | x(draft)
//   patchSnapshot          | x(ip) |   -
//   resetDsp               |  null |  kept
//
// Bulk-flush coordination (the rev counters and in-flight send tracking) now
// lives in src/runtime/commit.ts; the state layer no longer owns it, since
// state must not import the runtime layer.
export interface DspState {
  // Our belief about device RAM. Mutates on every user write; reset to null
  draft: DspSnapshot | null;

  // The dirty-diff baseline: snapshot of what `draft` looked like at the
  // last preset save/load (or initial connect). Stays pinned until an
  // explicit baseline-refresh moment; does NOT auto-update on resync.
  // The preset-dirty getter compares `draft` against `saved` to decide
  // whether the active preset has unsaved edits. Survives disconnect so
  // an eventual offline view can render the last-known-good state.
  saved: DspSnapshot | null;

  // Pending optimistic writes scheduled by src/runtime/commands.ts.
  // Each in-flight command holds a Symbol token; isInFlight observes
  // the set's reactivity to drive the UI dirty indicator.
  pendingWrites: SvelteSet<symbol>;
}

// Class-based state: $state is deeply reactive, for objects we mutate
// in-place like DspSnapshot. The DspState interface is satisfied in full;
// callers are unchanged.
class DspStateImpl implements DspState {
  draft = $state<DspSnapshot | null>(null);
  saved = $state<DspSnapshot | null>(null);
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

// Full baseline: draft + saved from one snapshot. Deep-copy into saved so
// patchSnapshot's in-place edits to draft cannot leak into the dirty baseline.
function applyBaseline(snapshot: DspSnapshot): void {
  dsp.draft = snapshot;
  dsp.saved = structuredClone(snapshot);
}
// Apply a fresh snapshot as a new baseline (draft + saved). The device owns
// the wire packet now (getSnapshot retains it), so no wire base is passed.
export function applyBaselineSnapshot(snapshot: DspSnapshot): void {
  applyBaseline(snapshot);
}
// Draft-only refresh: advance draft, leave saved (the dirty baseline) pinned.
export function applyDraftSnapshot(snapshot: DspSnapshot): void {
  dsp.draft = snapshot;
}

export function resetDsp(): void {
  dsp.draft = null;
  // dsp.saved intentionally NOT reset -- last known good survives
  // until the next successful sync overwrites it.
  dsp.pendingWrites = new SvelteSet();
}

// Single mutation point for in-place snapshot edits. Both the mutation
// factory and connect-time reconciliation funnel through here so any
// future cross-cutting hooks (undo, change events) have one place to
// attach. patchSnapshot touches `draft` only; saved stays at last sync.
export function patchSnapshot(patch: Partial<DspSnapshot>): void {
  if (dsp.draft) Object.assign(dsp.draft, patch);
}

// Copy current draft > saved. Used after PresetSave(active): RAM didn't
// change but the dirty-diff baseline must advance so the just-saved state
// is no longer "dirty". No-op when draft is null (disconnected).
// $state.snapshot() is the correct primitive for cloning *out of* the
// reactive system: it strips proxies and returns a plain-object deep copy
// without a second traversal. Contrast with applyBaseline's structuredClone,
// which clones *into* the reactive system from a plain input - the opposite
// direction.
export function refreshSavedFromDraft(): void {
  if (!dsp.draft) return;
  dsp.saved = $state.snapshot(dsp.draft) as unknown as DspSnapshot;
}
