import { SvelteSet } from 'svelte/reactivity';
import { type DspSnapshot } from '@/domain';

// Device-state truth lives in two cells: `draft` (our belief of device RAM)
// and `saved` (the dirty-diff baseline). The wire packet lives inside the
// device (DspDevice retains it), so the store works purely in domain snapshots.
// Each public verb writes a fixed subset — keep this matrix in sync:
//
//   verb                   | draft | saved
//   -----------------------|-------|--------
//   applyBaselineSnapshot  |   x   |   x
//   applyDraftSnapshot     |   x   |   -
//   refreshSavedFromDraft  |   -   | x(draft)
//   patchSnapshot          | x(ip) |   -
//   resetDsp               |  null |  kept
//   resetSavedBaseline     |   -   |  null
//
// Both cells are encapsulated behind the readonly DspStore view (external
// modules read them and call the verbs, but can't reassign). pendingWrites is
// readonly as a reference; the outbox calls .add()/.delete() on it directly.

// Module-private mutable instance — only the verbs in this file assign its
// cells.
class DspStateImpl {
  // Our belief about device RAM. Mutates on every user write; reset to null
  // on disconnect.
  draft = $state<DspSnapshot | null>(null);

  // Dirty-diff baseline: what `draft` looked like at the last preset save/load
  // (or connect). Pinned until an explicit baseline refresh; does NOT auto-update
  // on resync. The preset-dirty getter compares draft against it. Survives
  // disconnect so an offline view can render last-known-good.
  saved = $state<DspSnapshot | null>(null);

  // Pending optimistic writes scheduled by src/runtime/outbox.ts.
  // Each in-flight command holds a Symbol token; isInFlight observes
  // the set's reactivity to drive the UI dirty indicator.
  pendingWrites = $state(new SvelteSet<symbol>());
}
const state = new DspStateImpl();

export interface DspStore {
  readonly draft: DspSnapshot | null;
  readonly saved: DspSnapshot | null;
  readonly pendingWrites: SvelteSet<symbol>;
}

export const dsp: DspStore = state;

// Reactive: read `isInFlight.current` from a Svelte template, $derived,
// or $effect. True while any mutation has an unconfirmed optimistic
// patch in flight or queued in a coalescer. Drives the dirty-state UI dot.
export const isInFlight = {
  get current(): boolean {
    return state.pendingWrites.size > 0;
  },
};

// Full baseline: draft + saved from one snapshot. Deep-copy into saved so
// patchSnapshot's in-place edits to draft cannot leak into the dirty baseline.
function applyBaseline(snapshot: DspSnapshot): void {
  state.draft = snapshot;
  state.saved = structuredClone(snapshot);
}
export function applyBaselineSnapshot(snapshot: DspSnapshot): void {
  applyBaseline(snapshot);
}
// Draft-only refresh: advance draft, leave saved (the dirty baseline) pinned.
export function applyDraftSnapshot(snapshot: DspSnapshot): void {
  state.draft = snapshot;
}

export function resetDsp(): void {
  state.draft = null;
  // state.saved intentionally NOT reset -- last known good survives
  // until the next successful sync overwrites it.
  state.pendingWrites = new SvelteSet();
}

// @internal — TEST-ONLY. Drops the dirty-diff baseline so a test starts from a
// clean both-null slate. NOT FOR RUNTIME USE: production relies on `saved`
// surviving disconnect (resetDsp preserves it); calling this in the app would
// break the last-known-good guarantee.
export function resetSavedBaseline(): void {
  state.saved = null;
}

// Single mutation point for in-place snapshot edits. Touches `draft` only;
// saved stays at last sync.
export function patchSnapshot(patch: Partial<DspSnapshot>): void {
  if (state.draft) Object.assign(state.draft, patch);
}

// Copy current draft into saved. Used after PresetSave(active): RAM didn't
// change but the dirty baseline must advance. No-op when draft is null.
// $state.snapshot() clones *out of* the reactive system (strips proxies);
// contrast applyBaseline's structuredClone, which clones *into* it.
export function refreshSavedFromDraft(): void {
  if (!state.draft) return;
  state.saved = $state.snapshot(state.draft) as unknown as DspSnapshot;
}
