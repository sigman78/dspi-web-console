# Overview

This document maps how UI gestures become DSP writes, and how device truth returns to the Svelte state model. The write architecture is **device-first**: the host keeps one reactive mirror of device RAM, every edit goes through a per-field ("granular") wire verb, and the mirror advances from the value we sent. There is no host-side wire packet, no optimistic-bulk lane, and no per-control policy table.

## Layers

```text
Svelte components
  read mirror.current and call runtime verbs
        |
        v
src/runtime/actions.ts and src/runtime/presets.ts
  public action API; each verb calls write(), scrub(), or writeChecked()
        |
        v
src/runtime/writes.ts  (write-lane helpers)
    - write(send, mutate): click-paced. Await the wire ack, then mutate the
      mirror. No optimism, no coalescing. Failure -> forceResyncNow.
    - scrub(key, mutate, send): drag-paced. Optimistic mutate, per-key 16 ms
      latest-wins coalesce lane. No resync on success.
    - writeChecked(op, send, patch): commit-paced commands returning a typed
      Result. Non-ok -> warn toast (local rejection), no resync. Patch on ok.
        |
        v
src/device/DspDevice.ts  (granular set*/get* verbs)
  encodes protocol commands over a DspTransport
  (WebUsbTransport, NodeUsbTransport, or MockTransport)
```

These helpers send through `DspDevice`'s granular verbs. The bulk wire surface (`getAllParams`/`setAllParams`) survives only for full-state operations — connect-time fetch, failure recovery, preset transitions, and preset paste — never for the edit path.

## State Model

Per-device DSP parameter state lives on a `MirrorState` instance (`src/state/mirror.svelte.ts`), one per connected session. Its cells:

- `current`: our belief of device RAM. UI binds here. Mutates on every write.
- `baseline`: what `current` looked like at the last preset save/load (or connect). Pinned until a baseline refresh; `presetsDirty` diffs `current` against it.
- `inflight`: a counter bumped while a write is in flight. Drives the UI dirty dot and gates flush.

`MirrorState` is a class with mutation methods; callers read `mirror.current` (or the non-null `mirror.snapshot` accessor, which throws if read before sync) and call methods, but never reassign the cells.

- `init(snap)` -- set `current` **and** `baseline` from one snapshot (baseline deep-cloned). Connect and preset transitions (Load / Paste / Revert).
- `replaceCurrent(snap)` -- advance `current` only, leave baseline pinned. Failure-recovery resync (the user's pre-failure edits stay "dirty against the preset", which is correct).
- `captureBaseline()` -- advance baseline from `current` after PresetSave(active): RAM didn't change, but the dirty-diff origin must move.
- `reset()` -- clear `current` (baseline left pinned). Disconnect does not call this: it disposes the whole session (below), and a reconnect builds a fresh `MirrorState`.

There is **no** host-side wire packet. `DspDevice` does not retain a `BulkParams`; reads decode a fresh packet on demand via `fromBulkParams`. `src/runtime/**` and `src/domain/**` never reference `BulkParams`. The snapshot/wire boundary is decode-only and lives in `src/protocol/snapshotCodec.ts`.

The app is **session-based**: connection phase is an `AppState` discriminated union (`noDevice | connecting | ready | errored`) driven by `dispatch` in `src/state/appState.svelte.ts`, and `activeSession()` returns the ready session or null. All per-device state -- `device`, `info`, `hardware`, `mirror`, `telemetry`, `presets`, `writes`, `copySource` -- lives on a `ReadySession` built by `src/state/makeSession.svelte.ts`. There is no generation counter: each session carries an `alive` flag and a `dispose()` (called on disconnect) so stale async work settles silently. This per-session shape is the foundation for multiple connected devices -- see `MULTIDEVICE.md`.

## Write Paths

Every action verb routes to one of the helpers in `src/runtime/writes.ts`. Scrub-class membership is implicit at the call site (a verb either calls `scrub` or `write`); there is no central policy table.

**Direct class (`write`)** — toggles, dropdowns, channel names, output enable/mute/delay, EQ band commits. The helper awaits the wire ack, then mutates the mirror. On throw it flips status to `error` and calls `forceResyncNow` to recover ground truth; the mutate is never applied on failure. There is **no trailing resync on success** — a successful ack means firmware committed, and the mirror takes the value we sent. Alive-guarded: a send that settles after its session was disposed (disconnect) is dropped, since `s.alive` is re-checked before any mutation.

**Scrub class (`scrub`)** — the 12 continuous-drag range sliders: `masterVolume`, `masterPreamp`, `inputPreamp:{ch}`, `crosspoint:{in}:{out}`, `outputGain:{slot}`, `loudnessRefSpl`, `loudnessIntensity`, `crossfeedFreq`, `crossfeedFeedDb`, `levellerAmount`, `levellerMaxGain`, `levellerGate`. The helper mutates the mirror immediately (drag feel), then schedules a coalesced send on a per-key 16 ms latest-wins lane. On **success it does not resync** — the optimistic mutate already left the mirror at the value we sent; it only requests a background reconcile (see below). On **failure** it runs `forceResyncNow` to recover ground truth. Crosspoint writes read the full `{ enabled, invert, gainDb }` tuple at fire time, so a toggle and a gain drag on the same cell coalesce into one consistent write.

**Checked class (`writeChecked`)** — the output pin / I2S config verbs (`setOutputDataPin`, `setOutputType`, `setI2sBckPin`, `setMckEnabled`, `setMckPin`, `setMckMultiplier`), whose device methods return a typed `Result<void, PinConfigResult>` rather than a bare ack. Same machinery as `write()` (per-session alive guard, inflight registry), but the device can **decline** a valid-looking command (pin in use, output active): a non-ok `Result` becomes a warn toast carrying the device's own message, the mirror is left untouched, and there is **no resync and no status flip** — a single rejected command is local, not a connection error. On ok it patches the mirror with the requested value (no readback). An actual throw (transport/bug) is an error toast, still local. The verbs are fire-and-forget `void`: success and failure both reach the user via the toast channel, so callers never await a `Result`.

All three lanes request a background reconcile on success and never re-fetch inline — `write()`, `scrub()`, and `writeChecked()` all honor `requestReconcile(settings.eagerReconcile)`. Reconciliation is owned by the background param poll (below), which makes drift correction a property of the system rather than of every write path. `writeChecked()` and the standalone device commands (`setMasterVolumeMode`, `saveMasterVolumeBaseline`) share a `command(op, send, onSettled)` substrate in `writes.ts` that provides the per-session alive guard, inflight registry, and throw -> error-toast; `writeChecked()` layers the typed-`Result` rejection→warn-toast and mirror patch on top.

`flushAllWrites()` drains every armed scrub lane and awaits in-flight `write()`/`writeChecked()` promises; preset flash operations call it before issuing a command. `cancelAllWrites()` cancels lanes without firing and clears the in-flight registry; the disconnect path calls it.

## Read And Resync Paths

`src/runtime/resync.ts` has exactly two entry points:

- `forceResyncNow(s)` — bulk re-fetch + **current-only** apply (`mirror.replaceCurrent`). Failure recovery only (`write()`/`scrub()` throw paths). Current-only so the preset-dirty diff measured against the baseline does not drift on every resync.
- `fetchAndApplyAsBaseline(s)` — bulk re-fetch + **atomic baseline** apply (`mirror.init`). Preset Load / Paste / Revert, where there is no meaningful dirty state; the atomic apply avoids the microtask window where `current` and baseline disagree and observers see a spurious dirty flip.

Both take the session explicitly rather than resolving an active-device global. Initial connection calls `wireUpConnection(device)` -> `syncDeviceSnapshot(session)` -> `getSnapshot()` -> `mirror.init(snap)`, then starts polling and registers `cancelAllWrites` as a scope disposer. These whole-device service functions (`wireUpConnection`, `syncDeviceSnapshot`, `reconcileAfterSync`, `attachTransportListeners`, `factoryResetDevice`) live in `src/runtime/deviceService.ts` (renamed from `actionsDevice.ts`), split out from the per-parameter verbs in `actions.ts`, and each acts on the session it is given.

### Background param reconcile

A successful write/scrub does **not** re-fetch inline. Instead it sets a reconcile flag (`requestReconcile` in `src/state/mirror.svelte.ts`), and a dedicated `param` cadence in `src/runtime/poll.ts` performs the bulk re-fetch (`getSnapshot` → `mirror.replaceCurrent`, baseline pinned) when it is eligible. Eligibility (`shouldRunParam`) requires all of:

- **idle** — `mirror.inflight === 0`, **and** writes have been quiet for `RECONCILE_QUIET_MS` (100 ms). The inflight counter alone is insufficient: it drops to 0 in the ~16 ms gaps between coalesced scrub sends, so a tick landing in a gap would see "idle" mid-drag. The quiet window since the last `write()`/`scrub()` call (`lastWriteMs`) is what actually distinguishes mid-drag from drag-done.
- **pending** — a reconcile was requested since the last run (peeked, not consumed, so a skipped tick stays pending).
- **due** — either the request was **eager** (`settings.eagerReconcile`), or the floor interval (`PARAM_INTERVAL_MS`, 3 s) has elapsed (the first reconcile of a session, `lastParamMs === 0`, is always due).

`pollParam` also re-checks the idle condition **after** the `getSnapshot` await: if a write landed during the fetch, the snapshot is stale relative to the user's latest optimistic value, so it is discarded and the request left pending. The request is `consumeReconcile`'d only on a successful, still-valid apply — a fetch failure or a mid-fetch write keeps it pending for the next eligible tick.

With `eagerReconcile` **off** (default), drift self-corrects on the ~3 s floor cadence; with it **on**, a settle reconciles at the next idle tick. The flag is a temporary safety hatch — remove once firmware cross-coupling is ruled out and clamp parity is audited. See `DEVICE-BASED-MODEL.md`.

Telemetry cadences (status/buffer/info) in `src/runtime/poll.ts` are independent of parameter writes; the `param` cadence is the one that observes them (via the reconcile flag).

## Connection Lifecycle

`src/runtime/boot.ts` creates a transport, wraps it with timeouts, creates `DspDevice`, and calls `wireUpConnection` (which builds the `ReadySession` via `makeReadySession` and dispatches it as the active session). `ConnectionScope` owns per-connection disposers: polling, command cancellation, write-lane cancellation, and transport listeners.

On disconnect, the handler disposes the connection scope (polling, listeners, resync), dispatches `disconnected` (app -> `noDevice`), and disposes the outgoing session (`alive = false`, write lanes cancelled). Per-session stores -- mirror, telemetry, presets, writes -- die with the session; a reconnect builds fresh ones via `makeReadySession`, so there is no global state to reset.

## Preset Paste

Paste copies a source slot's content into the active slot and commits it immediately. The active slot remains active, its flash content is replaced with the source content, RAM matches that flashed state, and the mirror is refreshed as a clean baseline.

1. `flushAllWrites()` — settle in-flight edits before touching preset flash/RAM.
2. `loadPreset(src)` — pull the source slot into RAM and move the device pointer to `src`.
3. `captureState()` — read the source content as an opaque `DeviceState` blob.
4. `loadPreset(active)` — restore the previous active slot and device pointer before writing the captured source over it.
5. **Write-format gate** — `acceptsWriteFormat(device.capabilities, sourceBlob.formatVersion)` must hold (the captured blob's wire version must be writable to this device), else paste is refused with a clear error. Guards against silent corruption when a blob is pasted to a device that cannot accept that wire format.
6. `restoreState(blob)` — push the source content into the active slot's RAM without changing the active pointer.
7. `savePreset(active)` — flash the active slot with the restored source content.
8. `fetchAndApplyAsBaseline(s)` and `reconcileAfterSync(s)` — refresh the mirror and baseline from device state, then re-apply connection-level UI policy such as soft mute.

## Load-Bearing Details

- **Scrub lanes are per key.** A global lane would drop edits when moving quickly between adjacent mixer cells.
- **Per-session `alive` guard** lives inside `write()`, `scrub()`, and `writeChecked()` (and the shared `command` substrate). The session captured at call time is re-checked (`s.alive`) before any mirror mutation or recovery resync, so a stale settle from a disposed connection cannot corrupt a newly-connected one (always a fresh `ReadySession`). This is the single most bug-prone piece; it is covered in tests.
- **EQ band edits mutate optimistically.** `setEqFilter` writes the clamped value into the mirror before calling `write()` (with an empty success mutate), so the EQ curve tracks a node drag without waiting for the ack. On failure the trailing `forceResyncNow` from `write()` corrects it. This is a deliberate exception to the direct-class "await-then-mutate" rule, made for drag responsiveness.
- **No write path resyncs inline on success.** Both direct and scrub writes leave the mirror at the value they sent and request a background reconcile instead (see Background param reconcile). A UI/firmware clamp mismatch persists only until the next eligible param poll (≤ ~3 s on the floor cadence, or the next idle tick when `eagerReconcile` is on). Values are clamped at the action boundary via `src/domain/clamp.ts`, the single authoritative host-side gate (including the `copyEqBands` path). Channel/preset names are truncated to their UTF-8 byte budget at the same boundary.
- **The param reconcile is gated on a write-quiet window, not just inflight.** `shouldRunParam` returns false while any write is in flight *and* until writes have been quiet for `RECONCILE_QUIET_MS` (100 ms) — because inflight is 0 in the gaps between coalesced scrub sends, inflight alone does not prevent a mid-drag re-fetch. `pollParam` additionally re-checks after its `getSnapshot` await and discards the snapshot if a write raced the fetch. Both are covered in `poll.test.ts`.
- **Mutating preset verbs return a typed `Result`**; the error banner is recorded via `presets.lastActionError`, dismissed only through `dismissPresetActionError()`. Components never write preset store state directly. Boolean device flags use explicit `setX(enabled)` verbs, not `toggleX()`.
- **DSP action verbs take their `ReadySession` explicitly** (`s: ReadySession` first arg) and read `s.device`/`s.mirror.snapshot` — no ambient active-device global, no precondition-resolver layer. The old per-verb `if (!d) return` no-device guards were dropped: a `ready` session always has a device. Device-command outcomes surface through the transient toast channel (`pushNotice`), not return values: the `writeChecked` lane warn-toasts a device rejection, and the one-shot `factoryResetDevice` wraps its multi-step body in an explicit `try/catch` that toasts. A failed action never flips the connection phase — that is owned by the app machine / lifecycle.
- `MockTransport` keeps direct-getter behavior and bulk-packet behavior aligned; tests rely on it as the wire-faithful development device.

## Key Files

| Concern | File |
| --- | --- |
| App state machine (phase + active session) | `src/state/appState.svelte.ts` |
| Session factory (assembles a `ReadySession`) | `src/state/makeSession.svelte.ts` |
| Connect / boot entry points | `src/runtime/boot.ts` |
| Public DSP actions (per-parameter verbs) | `src/runtime/actions.ts` |
| Connection & whole-device services | `src/runtime/deviceService.ts` |
| Preset actions | `src/runtime/presets.ts` |
| Write helpers (write/scrub/writeChecked/flush/cancel) | `src/runtime/writes.ts` |
| Resync helpers | `src/runtime/resync.ts` |
| DSP state mirror + reconcile signal | `src/state/mirror.svelte.ts` |
| Telemetry + param reconcile poll | `src/runtime/poll.ts` |
| Preset state + dirty diff | `src/state/presets.svelte.ts` |
| Device wire API (granular + bulk) | `src/device/DspDevice.ts` |
| Snapshot decode (wire -> domain) | `src/protocol/snapshotCodec.ts` |
| Firmware capability derivation | `src/protocol/capabilities.ts` |
| Protocol codecs | `src/protocol/` |
| Multi-device foundation notes | `docs/MULTIDEVICE.md` |
