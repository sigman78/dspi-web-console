# Overview

This document maps how UI gestures become DSP writes, and how device truth returns to the Svelte state model. The write architecture is a single write outbox driven by a per-control policy table, plus a separate preset/runtime surface.

## Layers

```text
Svelte components
  read dsp.draft and call runtime verbs
        |
        v
src/runtime/actions.ts and src/runtime/presets.ts
  public action API; each write verb calls outbox.enqueue(intent)
        |
        v
src/runtime/outbox.ts  (single write outbox)
  reads src/runtime/controlPolicy.ts to route each intent by strategy:
    - granular: per-key 16 ms scrub lane -> a granular DspDevice method;
      converges via a trailing resync.
      (master volume, preamps, output gain, matrix cell)
    - bulk: optimistic draft mutation -> DspDevice.applyBulk(draft);
      self-converging, optionally debounced 16 ms.
      (EQ bands, output delay/mute/enable, names, processing controls)
```

The outbox writes through `DspDevice`, which encodes protocol commands and uses a `DspTransport` implementation (`WebUsbTransport`, `NodeUsbTransport`, or `MockTransport`). `outbox.flush()` drains every pending write so operations that must observe settled RAM (preset save/load/paste) see a converged device.

## State Model

`src/state/dsp.svelte.ts` owns the DSP parameter model:

- `draft`: optimistic belief about device RAM. UI reads this.
- `saved`: dirty-diff baseline used by preset dirty tracking. It advances on initial sync, preset load/revert, and preset save.
- `pendingWrites`: tokens for active granular and bulk writes. Resync skips while this set is non-empty.

`draft` and `saved` are encapsulated behind a readonly `DspStore` view: external modules read them and call mutation verbs (`applyBaselineSnapshot`, `applyDraftSnapshot`, `patchSnapshot`, `refreshSavedFromDraft`, `resetDsp`) but cannot reassign the cells (compile error). `pendingWrites` is readonly as a reference; the command lanes mutate it via `.add()`/`.delete()`.

The store no longer holds the wire packet. `DspDevice` owns the last-accepted `BulkParams` privately (`#wireBase`) and exposes a snapshot-in / snapshot-out surface: `getSnapshot()` (fetch + retain packet, return a `DspSnapshot`), `applyBulk(draft)` (overlay the draft onto the retained packet, send, retain), and an opaque `captureState()`/`restoreState()` pair for the preset-paste device-to-device copy. The snapshot⇄wire mapping and enum narrowing live in `src/device/snapshotCodec.ts`; `src/runtime/**` and `src/domain/**` never reference `BulkParams`. This snapshot-in/out surface is the lean, runtime-facing `DspDevice`; the full granular `set*`/`get*` CRUD (used only for wire-codec round-trip tests and hardware-in-the-loop cross-checks) lives in `src/device/DspDeviceGranular.ts`, a test/HIL-only subclass. Real connects construct `DspDevice`; only the mock/dev boot constructs the granular facade.

Bulk-write coordination (revision counters and the in-flight bulk promise) is module-private to the write outbox (`src/runtime/outbox.ts`), not part of the store. The runtime baseline-applier `applyBaselineConverged(snapshot)` resets those counters to mark "no unsent edits"; the bulk path gates its first send on `device.hasState`.

`src/state/session.svelte.ts` owns connection status, the active `DspDevice`, hardware profile, and a generation counter. Disconnect/cancel bumps the generation so stale async work settles silently.

## Write Paths

A write verb calls `outbox.enqueue(intent)`; the `controlPolicy` table decides the strategy and convergence.

Granular intents (`strategy: 'granular'`) are for controls where a full bulk write would be too heavy or could affect audio. They apply an optimistic patch immediately, coalesce per key for 16 ms, and send the latest value through a granular `DspDevice` method. Matrix crosspoint writes send the full `{ enabled, invert, gainDb }` tuple, read at fire time. On success they schedule a trailing resync (`converge: 'resync'`).

Bulk intents (`strategy: 'bulk'`) mutate `dsp.draft`, bump a revision, and send via `DspDevice.applyBulk(draft)` (the device overlays the draft onto its retained wire packet). If edits arrive while a send is in flight, one more bulk write carries the latest state after the first settles; the bulk path self-converges (`converge: 'self'`, no resync). Debounced bulk controls apply immediately but wait 16 ms of idle time before flushing.

`outbox.flush()` drains debounced timers, the granular scrub lanes, and the in-flight bulk write before preset flash operations.

## Read And Resync Paths

Initial connection calls `syncDeviceSnapshot()`, which fetches `getAllParams()` and applies it as a baseline. Successful Tier A writes schedule a trailing live-only bulk resync; that resync refreshes `live` and `wireBase` (leaving `shadow` pinned). Tier B writes update `wireBase` from the packet they successfully sent, so they do not need a trailing resync for normal convergence.

Preset load/revert/paste use `fetchAndApplyAsBaseline()` so `live`, `shadow`, and `wireBase` move together after firmware has applied the operation.

Telemetry polling in `src/runtime/poll.ts` is independent of parameter writes. It reads status, buffer stats, and slow system info into the telemetry store.

## Connection Lifecycle

`src/runtime/session.ts` creates a transport, wraps it with timeouts, creates `DspDevice`, binds it into session state, and finishes connection. `ConnectionScope` owns per-connection disposers: polling, resync cancellation, command cancellation, and transport listeners.

On disconnect, the app disposes the scope, cancels write lanes, bumps generation, clears live DSP state, invalidates preset cache, and resets telemetry. `shadow` survives disconnect as last-known baseline.

## Load-Bearing Details

- The outbox's granular scrub lanes are per key. A global lane would drop edits when moving quickly between adjacent mixer cells.
- Bulk finalization is guarded by a run-identity check so a stale detached send cannot clear a newer in-flight bulk write, and by the generation counter so a stale settle cannot advance convergence.
- The device owns the last-accepted wire packet (`DspDevice.#wireBase`); the store no longer mirrors it. A draft-only resync refreshes `draft` and leaves `saved` (the dirty baseline) pinned; the baseline verbs move both.
- Write values are clamped at the action boundary via `src/domain/clamp.ts` — the single authoritative host-side gate. UI controls keep input affordances, but a value reaching a runtime action is clamped there regardless of which component called it (including the `copyEqBands` path). Channel/preset names are truncated to their UTF-8 byte budget at the same boundary.
- Mutating preset verbs return a typed `Result` (`renamePresetSlot`, `setStartupDefault`, `setStartupMode`, `setPresetIncludePins` joined the load/save verbs); the error banner is still recorded via `presets.lastActionError`, dismissed only through `dismissPresetActionError()` — components never write preset store state directly. Boolean device flags use explicit `setX(enabled)` verbs, not `toggleX()`.
- `MockTransport` should keep direct getter behavior and bulk packet behavior aligned; tests rely on it as the wire-faithful development device.

## Key Files

| Concern | File |
| --- | --- |
| Public DSP actions | `src/runtime/actions.ts` |
| Preset actions | `src/runtime/presets.ts` |
| Write outbox (enqueue/flush/cancel) | `src/runtime/outbox.ts` |
| Per-control write policy | `src/runtime/controlPolicy.ts` |
| Resync helpers | `src/runtime/resync.ts` |
| DSP state | `src/state/dsp.svelte.ts` |
| Device wire API (lean, runtime-facing) | `src/device/DspDevice.ts` |
| Granular CRUD facade (test/HIL-only) | `src/device/DspDeviceGranular.ts` |
| Snapshot/bulk mapping | `src/device/snapshotCodec.ts` |
| Protocol codecs | `src/protocol/` |
