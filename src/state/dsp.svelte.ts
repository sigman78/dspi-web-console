import { SvelteSet } from 'svelte/reactivity';
import type { DspSnapshot } from '@/domain';
import type { BulkParams } from '@/protocol';

export interface DspState {
  // Our belief about device RAM. Mutates on every user write; reset to
  // null on disconnect.
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

  // The wire baseline: the BulkParams packet the device most recently
  // accepted. toBulkParams overlays `live` onto this when building a bulk
  // write, so fields the snapshot doesn't carry (pins, raw indices, names
  // past totalChannelCount) survive. Null until first hydrate. See
  // docs/IDEAS.md §5.3 / §10.1.
  baselineBulk: BulkParams | null;

  // Bulk-write coordination (consumed by src/runtime/commit.ts).
  // All scalar, all O(1). failureCount is reserved for the §10.3 error-backoff
  // circuit-breaker (not yet consumed).
  flush: {
    inflight: Promise<void> | null;
    currentRev: number;
    lastSentRev: number;
    failureCount: number;
  };
}

// Class-based state: allows mixing $state (deeply reactive, for objects we
// mutate in-place like DspSnapshot) with $state.raw (shallow reactive, for
// objects whose identity must be preserved across reads, like BulkParams).
// The DspState interface is satisfied in full; callers are unchanged.
class DspStateImpl implements DspState {
  live = $state<DspSnapshot | null>(null);
  shadow = $state<DspSnapshot | null>(null);
  pendingWrites = $state(new SvelteSet<symbol>());

  // $state.raw: BulkParams is a large wire-format DTO. Deep proxying is
  // wasteful and breaks reference identity (toBe / === checks). Shallow
  // reactivity (tracking the reference itself) is all that's needed here.
  baselineBulk = $state.raw<BulkParams | null>(null);

  flush = $state({
    inflight: null as Promise<void> | null,
    currentRev: 0,
    lastSentRev: 0,
    failureCount: 0,
  });
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

// Full reset: both `live` and `shadow` reflect the incoming snapshot.
// Used at baseline-refresh moments (syncDeviceSnapshot on connect, factory reset).
// Preset Load/Save flows refresh `shadow` explicitly via
// refreshShadowFromLive() after a quiet live-only resync.
export function applyDspSnapshot(snapshot: DspSnapshot, bulk?: BulkParams): void {
  dsp.live = snapshot;
  // Deep copy: patchSnapshot mutates dsp.live in place. A shared
  // reference would let optimistic patches leak into shadow.
  dsp.shadow = structuredClone(snapshot);
  if (bulk !== undefined) {
    dsp.baselineBulk = bulk;
    // Fresh baseline => no unsent edits. (Hydrate semantics, §5.6.)
    dsp.flush.currentRev = 0;
    dsp.flush.lastSentRev = 0;
  }
}

// Live-only refresh: replaces `dsp.live` but leaves `dsp.shadow` pinned.
// Used by the resync layer after a successful write so the dirty diff
// keeps measuring against the last save/load baseline rather than
// chasing the device's latest state.
export function applyLiveSnapshot(snapshot: DspSnapshot): void {
  dsp.live = snapshot;
}

export function resetDsp(): void {
  dsp.live = null;
  // dsp.shadow intentionally NOT reset -- last known good survives
  // until the next successful sync overwrites it.
  dsp.pendingWrites = new SvelteSet();
  dsp.baselineBulk = null;
  dsp.flush.inflight = null;
  dsp.flush.currentRev = 0;
  dsp.flush.lastSentRev = 0;
  dsp.flush.failureCount = 0;
}

// Single mutation point for in-place snapshot edits. Both the mutation
// factory and connect-time reconciliation funnel through here so any
// future cross-cutting hooks (undo, change events) have one place to
// attach. patchSnapshot touches `live` only; shadow stays at last sync.
export function patchSnapshot(patch: Partial<DspSnapshot>): void {
  if (dsp.live) Object.assign(dsp.live, patch);
}

// Copy current live → shadow. Used after PresetSave(active): RAM didn't
// change but the dirty-diff baseline must advance so the just-saved state
// is no longer "dirty". No-op when live is null (disconnected).
// $state.snapshot() is the correct primitive for cloning *out of* the
// reactive system: it strips proxies and returns a plain-object deep copy
// without a second traversal. Contrast with applyDspSnapshot's
// structuredClone, which clones *into* the reactive system from a plain
// input — the opposite direction.
export function refreshShadowFromLive(): void {
  if (!dsp.live) return;
  dsp.shadow = $state.snapshot(dsp.live) as unknown as DspSnapshot;
}
