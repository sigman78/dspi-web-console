import { SvelteSet } from 'svelte/reactivity';
import { type DspSnapshot, type HardwareProfile } from '@/domain';
import { fromBulkParams } from '@/device/snapshotCodec';
import type { BulkParams } from '@/protocol';

// Device-state truth lives in three cells: `live` (our belief of device RAM),
// `shadow` (the dirty-diff baseline), and `wireBase` (the wire packet
// `toBulkParams` overlays onto). The public verbs each write a fixed subset -
// keep this matrix in sync when adding one:
//
//   verb                  | live | shadow | wireBase
//   ----------------------|------|--------|----------
//   applyBulkBaseline     |  x   |   x    |    x
//   applyBulkLive         |  x   |   —    |    x
//   refreshShadowFromLive |  —   | x(live)|    —
//   patchSnapshot         | x(ip)|   —    |    —
//   resetDsp              | null |  kept  |   null
//
// There is no verb that sets a baseline without also refreshing wireBase:
// that combination would leave the wire overlay base stale and is unsafe by
// construction, so it is simply not expressible.
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

  // The wire baseline: the BulkParams packet the device most recently
  // accepted. toBulkParams overlays `live` onto this when building a bulk
  // write, so fields the snapshot doesn't carry (pins, raw indices, names
  // past totalChannelCount) survive. Null until first recv
  wireBase: BulkParams | null;
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
  wireBase = $state.raw<BulkParams | null>(null);
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

// The bulk packet is the canonical device state; the snapshot is a lossy view
// of it (drops pins, raw indices, names past the channel count). These two
// entry points are the ONLY way to push device state into the store, and both
// derive the snapshot from `bulk` themselves — so `live`, `shadow`, and
// `wireBase` can never be seeded from mismatched sources

// Private full-baseline write: live + shadow + wire baseline. `bulk` is
// mandatory — a baseline that left `wireBase` stale would corrupt the next
// overlay write, so that mode is not offered. Reached only via
// applyBulkBaseline. The bulk-flush revision counters are converged separately
// by the runtime helper `applyBulkBaselineConverged` (commit.ts), since that
// coordination lives in the runtime layer this state module cannot import.
function applyBaseline(snapshot: DspSnapshot, bulk: BulkParams): void {
  dsp.live = snapshot;
  // Deep copy: patchSnapshot mutates dsp.live in place. A shared
  // reference would let optimistic patches leak into shadow.
  dsp.shadow = structuredClone(snapshot);
  dsp.wireBase = bulk;
}

// Apply a freshly-fetched bulk packet as a new baseline (live + shadow +
// wire baseline). Use on connect, factory reset, and preset transitions.
export function applyBulkBaseline(hardware: HardwareProfile, bulk: BulkParams): void {
  applyBaseline(fromBulkParams(hardware, bulk), bulk);
}

// Apply a bulk packet as a live-only refresh: advances `live` AND `wireBase`
// to the freshly-fetched packet, leaving `shadow` (the dirty-diff baseline)
// pinned. Use on the trailing resync after a successful write, so the dirty
// diff keeps measuring against the last save/load baseline rather than chasing
// device state. wireBase is refreshed here so that wire-only fields (pins,
// channel names past totalChannelCount) from a device-side change are not
// clobbered by the next bulk overlay built against a stale base.
export function applyBulkLive(hardware: HardwareProfile, bulk: BulkParams): void {
  dsp.live = fromBulkParams(hardware, bulk);
  dsp.wireBase = bulk;
}

export function resetDsp(): void {
  dsp.live = null;
  // dsp.shadow intentionally NOT reset -- last known good survives
  // until the next successful sync overwrites it.
  dsp.pendingWrites = new SvelteSet();
  dsp.wireBase = null;
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
