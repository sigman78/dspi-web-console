# Multi-Device Foundation

This document records the refactor that made the console **internally session-based**: every piece of per-device state and every device-touching operation is now bound to an explicit session object, not to ambient global singletons. The app still drives one device at a time, but the architecture is the thing a second connected device would slot into without reworking the runtime.

## The problem it removes

Previously, per-device state lived in module-level singletons (the mirror, telemetry, preset cache, write lanes) and device-touching code reached for whichever device was "active" through an ambient global. With one device that is invisible; with two, it is a correctness hazard. An action started on device A could read or write device B's state if the active selection changed mid-operation, and there was no clean place to hold a second device's mirror, polling loop, or in-flight writes.

## What changed: state lives on the session

Per-device state was moved onto a single `ReadySession` object (`src/state/appState.svelte.ts`, built in `src/state/makeSession.svelte.ts`). One session owns its `device`, its reactive `mirror` (`MirrorState`), `telemetry` (`StatusStore`), `presets` (`PresetsState`), `writes` (`WriteCoordinator`), `copySource`, an `alive` flag, and a `dispose()` that tears those down. The app shell is a small state machine (`AppState` discriminated union -- `noDevice | connecting | ready | errored` -- driven by `dispatch`), and `activeSession()` returns the current ready session or null. Because state is per-session, building a second session is just another `makeReadySession(device)` call; nothing is shared or reset globally.

## What changed: operations take the session explicitly

The runtime no longer re-resolves "the active device" inside its functions. Every device-touching verb and service receives the session (or the narrowest input it actually needs) as a parameter, so it acts on exactly the device its caller named:

- Granular write verbs in `src/runtime/actions.ts` and preset verbs in `src/runtime/presets.ts` take `s: ReadySession` first.
- The write lanes in `src/runtime/writes.ts` (`write`, `scrub`, `command`, `writeChecked`) operate on the session they are given; `WriteCoordinator` is constructed with its own `MirrorState`, so inflight/alive/reconcile bookkeeping always lands on the right session, even across a reconnect.
- Polling is per-session: `startPolling(session)` in `src/runtime/poll.ts` captures that session's telemetry and mirror.
- The whole-device service layer was parameterized too: `syncDeviceSnapshot(s)` / `reconcileAfterSync(s)` in `src/runtime/deviceService.ts`, and `forceResyncNow(s)` / `fetchAndApplyAsBaseline(s)` in `src/runtime/resync.ts`. The state-layer `reconcileEqTarget(channels)` takes just the channel list it reads.
- `factoryResetDevice` resolves `activeSession()` exactly once at the UI entry point, then threads that session through its epilogue, so a single logical operation has a single device-resolution point.

The net effect: no function in `src/runtime/deviceService.ts` or `src/runtime/resync.ts` re-resolves the active-session global mid-operation. The cross-device contamination class (a snapshot or failed-write recovery from device A landing on device B's mirror) is closed by construction.

## What this enables

With state per-session and operations capability-passed, the remaining step to true multi-device is mechanical rather than architectural: replace the single `ReadySession | null` on the app shell with a `Map<DeviceSessionId, ReadySession>` plus an `activeSessionId`, and let the UI pick a session per tab. UI components already read the *selected* session (`activeSession()` in the shell, `getSession()` in the subtree), so they evolve into a per-tab selection rather than a rewrite. Each device gets its own mirror, telemetry, polling loop, and write lanes for free, and switching the active tab cannot leak one device's writes onto another.

## Deferred

One connection-lifecycle seam is intentionally left for the registry work: the disconnect handler in `src/runtime/deviceService.ts` (`attachTransportListeners`) still disposes `activeSession()` rather than the session belonging to the device that actually disconnected. It cannot be fixed by parameter-threading alone -- the per-connection session is created later in `wireUpConnection` -- so it lands with the `Map + activeSessionId` registry, which is where a device-to-session lookup will exist.

## Pinpoint: key files

- `src/state/appState.svelte.ts` -- `AppState` machine, `dispatch`, `activeSession()`; today holds one `ReadySession`, the future seam for `Map + activeSessionId`.
- `src/state/makeSession.svelte.ts` -- builds a `ReadySession` (device + mirror + telemetry + presets + writes + dispose).
- `src/state/mirror.svelte.ts`, `telemetry.svelte.ts`, `presets.svelte.ts` -- per-session reactive stores (no global singletons).
- `src/runtime/writes.ts` -- session-scoped write lanes; `WriteCoordinator` owns its `MirrorState`.
- `src/runtime/poll.ts` -- `startPolling(session)`.
- `src/runtime/deviceService.ts`, `src/runtime/resync.ts` -- whole-device services, all session-parameterized.
- `src/runtime/boot.ts` -- connect/boot entry points that create and wire a session per connection.
