# Overview

Top-level map of how a user gesture (slider drag, toggle click, EQ copy) becomes a DSP wire write, and how device truth gets back into the UI. Excludes Svelte rune mechanics — focuses on *what happens between layers* and the load-bearing guarantees.

## Layers

```
┌────────────────────────────────────────────────────┐
│  UI components (Svelte 5)                          │
│  read dsp.live / write via action functions        │
└──────────────────┬─────────────────────────────────┘
                   │ setMasterVolume(db) / toggleMute() / ...
                   ▼
┌────────────────────────────────────────────────────┐
│  src/runtime/actions.ts — public action API        │
│  one function per public effect; folds optimistic  │
│  patch + wire send into a command call             │
└──────────────────┬─────────────────────────────────┘
                   │ instantCommand / scrubCommand / batchCommand
                   ▼
┌────────────────────────────────────────────────────┐
│  src/runtime/commands.ts — command runtime         │
│  generation guard, per-key scrub lanes, pending    │
│  token lifecycle, error → forceResync              │
└────────┬───────────────────────┬───────────────────┘
         │                       │
         │ session.device.X(...) │ scheduleResync() / forceResyncNow()
         ▼                       ▼
  ┌─────────────┐         ┌──────────────────┐
  │ DspDevice   │         │ resync.ts        │
  │ (transport) │◄────────┤ trailing-edge    │
  │             │ getAll  │ bulk re-fetch    │
  └─────────────┘ Params  └──────────────────┘
                                  │
                          applyDspSnapshot(snap)
                                  ▼
┌────────────────────────────────────────────────────┐
│  src/state/dsp.svelte.ts — reactive store          │
│  live (optimistic), shadow (last good),            │
│  pendingWrites (dirty token set)                   │
└────────────────────────────────────────────────────┘
```

Polling (VU meters, status LEDs) runs on a separate timer in `poll.ts` and is not coupled to DSP parameter writes.

## Storage model

`dsp` (svelte `$state`) holds three snapshots:

- **`live`** — current optimistic belief about device RAM. UI reads from this. Mutated in place by `patchSnapshot()` after every command's `apply()`. Replaced wholesale by `applyDspSnapshot()` on full bulk fetch.
- **`shadow`** — last known good, deep-copied from `live` only by `applyDspSnapshot()` (full sync / resync). Optimistic patches do **not** touch shadow. Survives disconnect so a future offline UI can render last known device state.
- **`flashShadow`** — reserved for the future SaveParams/LoadParams firmware workflow. Always `null` today.

Plus one transient set:

- **`pendingWrites: SvelteSet<symbol>`** — every in-flight command holds a unique `Symbol` token here. `isInFlight.current` returns true while size > 0 and drives the UI dirty indicator.

`session` (svelte `$state`) holds device handle, status (`idle | connecting | connected | disconnected | error`), identity (serial/firmware/platform), and a **generation** counter that bumps on every `bindDevice` call and on `cancelAllCommands`.

## Command shapes

Three free functions in `commands.ts`. Each takes `apply()` (sync optimistic patch) and `send(device)` (async wire write).

| Shape | Purpose | Coalescing | Pending token |
|---|---|---|---|
| `instantCommand` | Toggles, one-shot selects | None — every call hits the wire | One per call |
| `scrubCommand({ key, ... })` | Numeric drag at ~60 Hz | Per-key 16 ms latest-wins lane | One per active burst on a key |
| `batchCommand` | Multi-write ops (EQ copy, future preset import) | N/A — caller controls the await sequence | One token across the whole send |

All three share `runGuarded`, which captures `session.generation` at send-launch time and gates post-send side effects on equality with the current generation. A stale settle (gen advanced by reconnect or `cancelAllCommands`) is a no-op.

`cancelAllCommands()` cancels every scrub lane, **bumps `session.generation`**, and clears `pendingWrites`. It is the disconnect path's single cancellation primitive. Any in-flight instant/batch/scrub send that was already past `lane.cancel()` will settle as stale via the gen guard.

## Lifecycle

**App boot.** Session is `idle`. `dsp.live = null`, `pendingWrites` empty.

**Connect.** Transport opens → `bindDevice(d)` increments `session.generation`. `fullSync()` fetches identity + bulk params, calls `applyDspSnapshot(...)` (replaces both `live` and `shadow`), starts polling, runs `reconcileAfterSync()` (re-applies UI policy like soft-mute to the new device).

**User edits.** UI calls action functions; commands run; live mutates optimistically; resync coalesces; shadow updates only on bulk re-fetch.

**Disconnect.** Transport `disconnect` event fires the handler:

```
cancelResync()        // drop the trailing 250 ms re-fetch timer
cancelAllCommands()   // cancel scrub lanes; bump generation; clear tokens
stopPolling()         // stop VU/status reads
setStatus('disconnected')
resetDsp()            // live = null, pendingWrites cleared; shadow preserved
resetStatus()
```

**Reconnect.** Same as Connect. The generation bump from `bindDevice` ensures any leftover async work from the previous device cannot mutate session state on settle.

## Interaction walkthroughs

### A. Toggle (loudness enable)

1. UI click → `setLoudnessEnabled(true)`.
2. Action reads `dsp.live?.loudness`, exits if no snapshot yet.
3. `instantCommand({ apply, send })`:
   - `apply()` runs sync: `patchSnapshot({ loudness: { ...cur, enabled: true } })`. UI re-renders.
   - Token added to `pendingWrites`. Dirty indicator on.
   - `send(d) = d.setLoudnessEnabled(true)` runs async.
4. On success: token cleared, `scheduleResync()` arms a 250 ms trailing bulk re-fetch.
5. On failure: token cleared, status flips to `'error'`, `forceResyncNow()` immediately re-fetches and overwrites `live` with device truth. Optimistic patch reverts visually.

### B. Slider drag (master volume)

1. Each drag event → `setMasterVolume(db)` → `_setMasterVolume(db)` → `scrubCommand({ key: 'masterVolume', ... })`.
2. `apply()` runs every call. `live.masterVolumeDb` updates at 60 Hz.
3. Per-key lane registry: first call in a burst creates a lane (or reuses the existing one), claims a pending token, arms a 16 ms timer.
4. Subsequent calls in the 16 ms window update the lane's pending thunk (latest wins) and skip re-arming.
5. Timer fires: snapshots thunk + token + generation, queues onto the lane's `inFlight` chain. Sends serialise per-lane (no two concurrent control transfers on the same logical control).
6. After the user stops dragging, the trailing resync at ~250 ms after the last successful send re-fetches bulk and reconciles `live` ↔ device truth.

### C. Adjacent mixer cells dragged in succession

User drags cell (0,0) gain, then immediately cell (0,1) gain.

- Different cells → different lane keys (`crosspointGain:0:0` vs `crosspointGain:0:1`).
- Two independent lanes → two independent timers → both wire writes happen.
- This is the explicit reason scrub lanes are *per-key*, not global: a global lane would drop one cell's value.

### D. EQ copy from channel A → B

1. UI calls `applyCopyFrom('A', 'B')` → `copyEqBands('A', 'B')`.
2. `batchCommand({ apply, send })`:
   - `apply()` runs once: builds the new `channels` array with all of B's filters replaced by A's, calls `patchSnapshot({ channels: next })`. UI shows the copied state immediately.
   - One token added to `pendingWrites`. Dirty for the entire wire burst.
   - `send(d)` awaits `d.setFilter(B, 0, ...)` then `d.setFilter(B, 1, ...)` … through all bands.
3. On success: token cleared, single trailing resync.
4. On any failure mid-burst: token cleared, `forceResyncNow()` re-fetches whole bulk. Some bands may have committed to device, some not — the resync converges everything to device truth.

### E. Reconnect during a slow USB send

Worst case for the gen guard.

1. User scrubs at t=0 ms. Lane fire at t=16 ms captures `gen=5`, kicks `device.setOutputGain(0, -3)`. USB takes 500 ms.
2. User unplugs at t=50 ms. Transport `disconnect` → `cancelAllCommands()` cancels lanes, bumps `session.generation` to 6, clears pendingWrites.
3. User reconnects at t=200 ms → `bindDevice(newDevice)` bumps to 7. `fullSync()` runs.
4. At t=550 ms, the original send rejects with a USB error from the now-detached device.
5. `runGuarded` catches: captured gen=5, current gen=7 → stale, silent return. **No** `setStatus('error')`, **no** `forceResyncNow()`.

Without the gen guard, the stale rejection would flip session to `error` after the user has already successfully reconnected.

## Quirks and load-bearing details

These are non-obvious behaviors a reader might trip over.

1. **Per-key scrub coalescing is the whole point of scrub lanes.** A global "one scrub at a time" lane would silently drop the last value when the user moves between adjacent controls fast. The mixer matrix and EQ band editors rely on per-key isolation.

2. **`setCrosspointGain` send re-reads the cell at fire time.** Every other action captures values at action-call time and closes over them. `setCrosspointGain` is the exception: its send reads `dsp.live?.routes` inside `send()` because `setMatrixRoute` writes the full `{enabled, invert, gainDb}` tuple, and an enable/invert toggle (instant) can land during the 16 ms scrub window. Capturing at call time would silently overwrite the toggle on the wire.

3. **Generation bump is the cancellation primitive.** No AbortController, no per-task cancellation tokens. Disconnect and `cancelAllCommands` both bump `session.generation`; in-flight async work checks equality on settle and becomes a no-op when stale.

4. **Optimistic patches are mutate-in-place on `live`.** `patchSnapshot` does `Object.assign(dsp.live, patch)`. `shadow` is only ever replaced wholesale by `applyDspSnapshot` (deep-copy), so optimistic edits cannot leak into shadow.

5. **Failure path overwrites everything.** `forceResyncNow()` re-fetches all bulk params and `applyDspSnapshot()`s the result, replacing both `live` and `shadow`. Any optimistic edits to *other* keys that hadn't yet flushed are visibly reverted. The plan's stance: a sub-300 ms flicker on a rare wire error is cheaper than per-key rollback bookkeeping.

6. **`scheduleResync` is debounced trailing-edge.** Each successful command call resets a 250 ms timer. Sustained scrubbing keeps pushing it out; the resync only fires after the user goes quiet. This soft-skip is also gated on `pendingWrites.size === 0` — the resync would clobber an in-flight optimistic patch otherwise.

7. **`batchCommand` vs looped `instantCommand`.** A batch holds *one* pending token across the whole send; ten independent instants would hold ten. The trailing resync coalesces in both cases (debounce), so the wire-write count is similar — the difference is dirty-state semantics during the operation and atomicity of the optimistic apply.

8. **Validation lives at the UI control boundary, not in the command layer.** The pre-migration `defineMutation` factory had per-mutation `validate` hooks; the new `commands.ts` has none. UI controls (`ValueField`, sliders) are responsible for clamping to domain limits before calling action functions. Non-UI callers (tests, scripts, future scripted automation) can send unclamped values to the wire — known and accepted.

9. **Polling is independent of DSP writes.** `poll.ts` reads VU/status separately. It does not interact with `pendingWrites`, `scheduleResync`, or `dsp.live` parameter fields. Bulk parameter fetches happen only on `fullSync` (connect) and `fetchAndApply` (resync).

10. **Soft mute is a UI policy that survives reconnect.** `toggleMute` writes `MUTE_DB = -128` and stores the pre-mute level in `settings.soft.mutedFromDb`. `reconcileAfterSync()` re-applies mute to a freshly-connected device. Persisted via localStorage in `settings.svelte.ts`.

11. **`dsp.shadow` survives disconnect on purpose.** `resetDsp()` clears `live` to `null` and empties `pendingWrites`, but leaves `shadow` intact. Future offline UI work can render a banner + disabled controls populated from shadow. Currently no UI consumes shadow during `disconnected` status.

12. **`flashShadow` is reserved.** Always `null` today. Will hold a snapshot of device flash contents once the SaveParams/LoadParams firmware workflow ships.

13. **Gen-capture timing differs by command shape.**
    - Instant/batch capture gen *synchronously at action call time* (no awaits between capture and send).
    - Scrub captures gen *at fire time inside the timer callback*, before the `inFlight` chain — not at schedule time, not at send time. Capturing at schedule time would suppress legitimate post-reconnect side effects; capturing at send time (after awaiting the chain) would let post-reconnect work mutate session state. Fire-time capture is the only correct point.

14. **Pending tokens are `Symbol`-keyed.** Each call mints a fresh `Symbol(label)` so two simultaneous in-flight tasks for the same logical control cannot collide on a shared key. Scrub lanes hold one token per *active burst* (created on first schedule of the burst, dropped when the lane fires); instant/batch hold one token per call.

## What this architecture does not handle

Documented gaps, called out so they don't surprise:

- **Per-band rollback on partial batch failure.** EQ copy of 10 bands; band 5 fails. Bands 0–4 may have committed to the device while bands 6–9 didn't. `forceResyncNow()` converges the snapshot to device truth, but there's no notion of "undo the partial commit." Acceptable for current use cases.
- **Concurrent automation drivers.** The model assumes single-source human UI editing. A second driver writing in parallel (scripted automation, second UI) would race against per-key lanes — no global locking.
- **Offline editing queue.** Disconnect cancels pending work; there's no notion of "buffer my edits and replay on reconnect."
- **Wire transactions.** Each `device.X(...)` is independent. A batch is just a sequential await; no atomicity guarantee at the wire level.

## Where to look

| Concern | File |
|---|---|
| Public action functions | `src/runtime/actions.ts` |
| Command runtime + scrub lanes | `src/runtime/commands.ts` |
| Reactive store + dirty indicator | `src/state/dsp.svelte.ts` |
| Session lifecycle + generation | `src/state/session.svelte.ts` |
| Bulk re-fetch + soft-skip | `src/runtime/resync.ts` |
| Polling | `src/runtime/poll.ts` |
| UI policy persistence (mute, theme) | `src/state/settings.svelte.ts` |
| Wire layer | `src/device/DspDevice.ts` |
| Snapshot domain types | `src/domain/snapshot.ts`, `src/domain/bulkToSnapshot.ts` |
