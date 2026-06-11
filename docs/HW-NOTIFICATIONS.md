# Device notifications (Notification Protocol v2)

How the console consumes the firmware's back-event channel. Sibling to
[FW-VERSIONS.md](FW-VERSIONS.md) (version strategy) and
[HW-DSPUSB.md](HW-DSPUSB.md) (wire reference). Authoritative firmware source:
`DSPi/Documentation/Features/notification_protocol_v2_spec.md` on `main`
(released 1.1.4; the `working_spdif_input` branch was merged and deleted).
Status: **shipped** — Layer 1 (notifyChannel reconcile triggers) and the
Layer 2 substrate (wireMirror splice + notifyApply targeted application)
are implemented in `src/runtime/`.

## Why this exists

The console's parameter mirror is **single-writer and optimistic**: it assumes
the console is the only thing changing device state. `poll.ts` reconciles the
param snapshot only when a reconcile is *requested*, which happens after the
console's *own* writes settle (`pollParam` / `shouldRunParam`). With no pending
request, the full bulk packet is never re-fetched.

That assumption breaks the moment the device changes state on its own:
firmware-internal clamps/recalcs, a preset load or factory reset, the deferred
input-source switch, and — in the future — **GPIO knobs/encoders**. Today such a
change is **invisible to the console** until the user happens to make some other
write. Notification v2 is the mechanism by which the device tells the host
"something changed out from under you," so the mirror can become multi-writer
aware.

This revises the deferral in [FW-VERSIONS.md](FW-VERSIONS.md), which assumed
"polling continues to work because all fields are mirrored in the bulk packet."
True that they are mirrored — but the console does not continuously poll them, so
external changes are missed.

## Firmware channel — verified facts

From released 1.1.4 `main` (`notify.c/.h`, `usb_descriptors.c`):

- **Bulk IN endpoint `0x83`, 64-byte packets, on the vendor interface** the
  console already claims (`ITF_NUM_VENDOR`, interface 2, class `0xFF`). The
  descriptor is `TUSB_XFER_BULK` (a stale comment calls it "interrupt" — it is
  bulk). WebUSB reads it with `transferIn(epNumber, 64)` on the claimed
  interface — no new claim, and bulk is far more reliable in WebUSB than
  interrupt.
- **Always-armed, never NAKs.** When the ring is empty the device arms a 1-byte
  `IDLE` (`0x00`) keep-alive (a deliberate workaround for an RP2xxx DCD crash
  under interrupt-IN + rapid EP0 SETUP). Consequence: the host **cannot
  block-wait** for an event — a read returns immediately with `IDLE` or an event.
  The host **paces its own reads**. (The Mac client reads with a 500 ms timeout
  and tolerates both `IDLE` packets and no-data timeouts.)
- **v2 packet header (4 bytes):** `version(=2)`, `event_id`, `flags(=0)`,
  `seq` (monotonic u8; a gap signals loss). Payload follows; size by
  `actual_length`, not a header length field.
- **Events:** `IDLE 0x00`, `MASTER_VOLUME_V1 0x01` (legacy, co-emitted),
  `PARAM_CHANGED 0x02`, `BULK_INVALIDATED 0x03`, `PRESET_LOADED 0x04`,
  `ERROR 0x05`.
- **`PARAM_CHANGED` payload:** `wire_offset(u16 LE)`, `wire_size(u16 LE)`,
  `source(u8)`, `reserved(3)`, then `wire_size` value bytes (same encoding as the
  bulk packet). `wire_offset` is `offsetof(WireBulkParams, field)` (arrays:
  `offsetof(array) + index*elemSize`). The host interprets the value by its own
  knowledge of the struct at that offset — **no event catalog to maintain.**
- **Bulk events** carry a `source` byte; `PRESET_LOADED` carries a slot byte and
  is followed by a `BULK_INVALIDATED`. Preset load / factory reset / bulk SET
  **suppress per-field events** and emit a single `BULK_INVALIDATED` — the host
  should re-read the whole bulk packet.
- **Source tags:** `UNKNOWN 0`, `HOST 1`, `BULK 2`, `PRESET 3`, `FACTORY 4`,
  `GPIO 5`, `INTERNAL 6`, `UAC1 7`. Lets the host suppress its own echoes.
- **Identity:** 1.1.4 bumps `bcdDevice` (Windows re-reads the descriptor) and
  ships an MS OS 2.0 descriptor that auto-binds WinUSB to interface 2 — likely
  **no Zadig** for new devices.

### Two facts that bound the value for 1.1.4

- **The UAC1 OS volume slider DOES notify** (since released 1.1.4): firmware
  emits `PARAM_CHANGED` with `source=UAC1` for user volume/mute changes
  (`usb_audio.c:1246-1260`). An earlier draft of this doc said it did not —
  that was true of the pre-merge branch only. The user-volume axis stays live
  for free once the console displays it (migration item M2).
- **GPIO control is not implemented in 1.1.4** — `PARAM_SRC_GPIO` exists but
  nothing emits it. It is the forward-looking motivation for the protocol's
  generality.

So in 1.1.4 the sources that actually fire are sparse and low-rate: `INTERNAL`
(clamps/recalc), the input-source-switch completion, and bulk ops
(`PRESET`/`FACTORY` → `BULK_INVALIDATED`). High-frequency external change arrives
only when GPIO ships.

## Reference: the Mac client

`_baseMac/.../InterruptMonitor.swift` + `DSPViewModel.swift` +
`Commands.swift:applyNotifiedParamChange`:

- A background read loop on EP `0x83`; drops `IDLE`; dispatches `PARAM_CHANGED`
  to the view model.
- **Echo suppression by `source != HOST`** — host setters already update local
  state synchronously.
- **Selective per-field apply**, not full decode: a curated allowlist of ~6
  fields (EQ bands, channel names, `dac_hw_mute`, `user_volume`,
  `lg_sound_sync`, `input_source`). The full offset decoder exists **only for the
  debug monitor's display log**.
- **Gap we will not copy:** `BULK_INVALIDATED` / `PRESET_LOADED` are decoded only
  for display — the sync path is `PARAM_CHANGED`-only. An *external* preset load
  never resyncs the Mac UI; it works only because the Mac's *own* preset ops call
  `fetchAll()` directly.
- Architecture: connect → `fetchAll`; 60 ms status poll; notifications for param
  deltas; no periodic param poll.

## Our architecture — layered, backstop-first

Three layers, with the bulk read as the non-negotiable correctness backstop.

### Layer 0 — existing bulk path (all firmware ≥ floor, unchanged)

The write-driven bulk reconcile (`pollParam`) and preset copy
(`captureState`/`restoreState`) are untouched. Notifications only affect the
*read/reconcile* path; preset copy is a write/restore op and stays on bulk. On
1.1.3 (no v2) the notify channel never starts — behavior is exactly as today.

### Layer 1 — NotifyChannel as a resync trigger (build now, 1.1.4+)

A host-paced read loop on EP `0x83`, started on connect for v2-capable devices
(`capabilities.features.notifications`, keyed on observed wire ≥ 7), stopped on
disconnect, owned by the connection scope.

Discriminate by length/version first: a 1-byte `0x00` is `IDLE`; byte 0 `== 0x02`
is a v2 packet (dispatch on byte 1); anything else is a v1 or unknown packet and
is dropped (a v2 device co-emits v1 master-volume packets for legacy hosts — we
ignore them, since the same change also arrives as a v2 `PARAM_CHANGED`). Then
decode the 4-byte v2 header only and dispatch:

| Event | Action |
|---|---|
| `IDLE` / v1 / unknown | drop |
| `BULK_INVALIDATED` | `requestReconcile()` |
| `PRESET_LOADED` | toast + `requestReconcile()` |
| `PARAM_CHANGED`, `source != HOST` | `requestReconcile()` |
| `PARAM_CHANGED`, `source == HOST` | drop (our optimistic mirror already has it) |
| `seq` gap detected | `requestReconcile()` |

No payload decode. Every trigger funnels into the **existing** mirror reconcile,
which already handles mid-drag safety. This fixes the single-writer staleness,
reuses all the hard reconciliation logic, and is **strictly more correct than the
Mac** (it has the `BULK_INVALIDATED` backstop the Mac lacks). Because a full
reconcile refreshes everything, it even subsumes the Mac's
input-source-switch → re-fetch-volume dance for free. Sufficient for all of
1.1.4's actual (sparse, low-rate) sources — a ~3 KB re-read per occasional event
is nothing.

**The one seam Layer 1 adds:** retain the raw `WireBulkParams` bytes on each
`getAllParams`. Layer 1 does not use them, but they are the shared substrate for
Layer 2 and for passthrough writes (see FW-VERSIONS.md) — capturing them now
means neither later step retrofits the read path.

### Layer 2 — precise per-field application (substrate shipped; per-field merge deferred)

Earns its keep only under high-frequency external change (GPIO). The model
reuses and generalizes existing pieces rather than adding a parallel addressing
layer.

**Substrate — the wire mirror.** The retained raw `WireBulkParams` buffer (full
fidelity, e.g. 2960 B on a V10 device). One artifact, three uses: patch target,
diff baseline, passthrough write source.

**Apply pipeline:**

```
PARAM_CHANGED {offset,size,value}
  → wireMirror.set(value.subarray(0,size), offset)   // eager, opaque byte splice
                                                      //   (trusts firmware offsetof;
                                                      //    sanity: offset+size ≤ len)
  → [batched on microtask/rAF for bursts]
  → parseBulkParams + fromBulkParams                  // EXISTING whole-buffer decoder
  → changeSet = diff(prevSnapshot, nextSnapshot)      // generalized presetDiff
  → mutate only changed paths into mirror.current     // fine-grained reactivity,
                                                      //   in-flight-guarded
  → recompute only affected derived state             // e.g. EQ curves per channel
```

Why this shape:

- **The splice needs zero codec/offset knowledge** — a pure byte copy at the
  firmware-supplied offset. No offset→field map, no codec introspection, no drift,
  and **full field coverage for free** (including V7–V10 bytes spliced before we
  even parse them).
- **A patch is just a bulk snapshot computed locally** — no USB round-trip — so it
  flows through the same decode + reconcile stack a device read uses.
- **The change-set comes from diffing domain snapshots, not wire offsets.** Paths
  are in the shape the UI uses (`eq[ch][band]`, `outputs[i].gainDb`), and the
  diff is **tolerance-banded** (`presetDiff.ts`) so float round-trip jitter does
  not register as change. This requires generalizing `presetDiff` from
  short-circuit boolean to a change-set collector; the existing dirty flag then
  becomes `changeSet.size > 0` — one diff, two consumers.
- **Change-set-driven mutation replaces whole-snapshot `replaceCurrent`** — mutate
  only changed paths so Svelte re-renders only what moved, and recompute only the
  affected derived state. This matches what the Mac does per-channel, but derived
  from data rather than hand-wired per field.

This supersedes a schema-derived offset→field index: that index existed only to
avoid the whole re-decode, which is cheap and yields worse (wire-shaped,
un-banded) change information.

**Deferred within Layer 2:** per-field in-flight-aware merge (apply external
changes to fields the user is *not* dragging while preserving the one they are)
needs per-field in-flight tracking; the current guard is global. Start with the
global guard (drop during a drag, backstop reconcile catches up); add per-field
merge only if concurrent multi-source editing proves real.

### Unification

The change-set diff is not notification-specific. The full bulk-reconcile path
(`pollParam`) and dirty detection can adopt the same diff to do minimal updates —
a cleanup that pays off independent of notifications.

## Transport surface

The console is control-transfer-only today (`ctrlIn`/`ctrlOut`). The notify
channel adds one capability — a bulk-IN read — to `DspTransport`:

- `WebUsbTransport`: `transferIn(epNumber, 64)` on the claimed vendor interface;
  resolve the notify endpoint number from the interface's alternate.
- `NodeUsbTransport` (HIL): the equivalent in-endpoint read.
- `MockTransport`: a synthesizable notify queue so the channel and its event
  handling are testable without hardware (push `IDLE` / `PARAM_CHANGED` /
  `BULK_INVALIDATED` packets on demand).

The read loop is host-paced (the device never blocks): issue a read, handle the
result, schedule the next. Pacing balances event latency against idle bus
traffic.

## Read cadence, idle load, and threading

The firmware **re-arms the endpoint immediately on every transfer completion**
(`xfer_cb` → `usb_notify_drain`, `usb_audio.c`), arming a 1-byte `IDLE` when the
ring is empty, and never NAKs. So there is no "block until an event" to rely on:
a continuously-outstanding `transferIn` returns a flood of `IDLE` at bus rate
(~1000/s). The host therefore **paces** its reads — `transferIn` → handle →
delay → repeat. During the delay the host issues no IN tokens; the device's
armed `IDLE` simply waits, so there is **no bus traffic between reads**. The
cadence is the host's knob, and **event latency equals the cadence** (an event
sits in the ring until the next read).

We poll the cheap 64-byte notify EP, not the ~3 KB bulk packet, and most reads
are a 1-byte `IDLE` we drop — so each idle tick is one tiny transfer plus a
trivial wakeup.

- **Cadence:** loose by default (~100–250 ms) — negligible idle load, fine
  latency for 1.1.4's sparse/low-rate sources. **Adaptive:** tighten transiently
  after a non-idle event (events cluster, e.g. a GPIO sweep), then back off.
  Don't pace *too* slowly — the firmware notes a macOS "cold pipe drops the first
  packet after a long idle" bug the keep-alive mitigates, so very long pauses
  risk a dropped first packet on some stacks.
- **Visibility / idle state:** see below.
- **Power:** the device is already an active USB-audio stream (not suspending),
  so the incremental cost of a loose notify poll is small.

### Idle state (tab hidden)

When the tab is hidden the console should go fully quiet, then repaint to truth on
return. Most of this exists: `poll.ts` already pauses every cadence when hidden
(`tick()` bails on `isHidden()`; `onVisibility` cancels/re-arms the clock), so
there are already zero poll wakeups and zero control transfers while hidden.
Disconnect/reconnect stay live because they are event-driven (`navigator.usb`
listeners), not polled, so pausing never blinds us to the device leaving.

Two additions complete the idle state:

1. **The notify read loop pauses with visibility** — on hide, stop scheduling the
   next `transferIn`; on show, resume the loop. An in-flight read just resolves
   and isn't re-issued. (Owned by `NotifyChannel`, since it only exists on 1.1.4+.)
2. **On resume, force one eager full reconcile, then unpause** — `poll.ts`'s param
   cadence only runs when a reconcile is requested, so after a long hidden window
   the mirror would otherwise stay stale until the next write. Firing
   `requestReconcile(eager)` on `visible` pulls a fresh bulk snapshot and catches
   up on everything missed during the blind window — external changes *and* any
   notification dropped by a cold pipe on the first post-idle read. This makes
   hidden-pausing safe (we re-read ground truth on return) and is **device-
   agnostic** — valuable on 1.1.3 too — so it lives in the poll/session layer
   (`onVisibility`), not in `NotifyChannel`.

Result: hidden ⇒ no timers, no host-initiated USB traffic, the tab fully
backgroundable, while the OS-owned USB-audio stream keeps playing untouched. On
return ⇒ one full reconcile repaints to current truth, then both loops resume.

### Threading / Web Worker

**Layer 1 runs on the main thread — no worker.** The loop is I/O-bound and
`transferIn` is already async (USB I/O runs off the JS thread in the browser's
USB service); per-event JS is just `requestReconcile`. A worker buys nothing.

A decisive constraint also rules out a *partial* offload: a `USBDevice` can be
open in only one context, so control transfers and notify reads must share one
handle. Putting only the read loop in a worker is impossible without moving the
**entire** transport there (worker owns the device, proxies every transfer) — a
large restructuring for no benefit.

The clean worker boundary, if ever needed, is **Layer 2's CPU work, not the
I/O**: splice + re-decode + change-set diff is pure computation with no device
coupling. Under future GPIO-rate sweeps the raw wire bytes could be posted to a
worker (transferable `ArrayBuffer`) and a change-set posted back, keeping the
main thread smooth. Measure first — rAF-batched projection on the main thread
likely suffices.

## Capability gating & lifecycle

- Gated by `capabilities.features.notifications`, derived in
  `deriveCapabilities` (observed wire ≥ 7 ⇒ 1.1.4+). Absent on 1.1.3 → channel
  never starts.
- Started on connect (after the initial snapshot), stopped on disconnect,
  disposed via the connection scope (same lifecycle discipline as polling).
- The status/peaks/buffer poll cadences in `poll.ts` are unaffected — they cover
  audio telemetry (meters, CPU), which notifications deliberately do not.

## Failure modes

| Scenario | Detection | Behavior |
|---|---|---|
| Device sends only `IDLE` for a long time | normal | drop; keep reading |
| `seq` gap (ring overflow / dropped read) | non-contiguous `seq` | force a full reconcile (bulk truth heals it) |
| Lost *final* event (no follow-up to trigger reconcile) | — | optional slow heartbeat reconcile self-heals |
| Endpoint stall | read error | clear stall, continue; escalate to disconnect if persistent |
| Disconnect mid-read | read aborts / device gone | stop channel, tear down with the connection scope |
| `PARAM_CHANGED` offset/size out of range | `offset+size > len` | ignore the splice; the backstop reconcile corrects state |

## Scope summary

**Shipped (Layer 1):** capability flag; bulk-IN transport method + `MockTransport`
synthesis; `notifyChannel` read loop mapping events → reconcile (+ preset
toast); `seq`-gap handling; raw wire buffer retained on `getAllParams`.

**Shipped (Layer 2 substrate):** wire-mirror splice (`wireMirror.ts`) and
targeted notify application (`notifyApply.ts`). Still deferred: per-field
in-flight-aware merge (global guard remains).

**Out of scope:** full offset→field index (superseded by the domain diff);
decoding v1 master-volume packets (we gate on v2).
