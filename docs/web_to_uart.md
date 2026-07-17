# Web-to-UART bridge: ESP32 WiFi control for DSPi

Feasibility study and API design, 2026-07-16. Firmware facts verified against
`WeebLabs/DSPi` `release/v1.1.5` head `302fe19` (fw 1.1.5, external-control
protocol version 1, wire format V24).

**Verdict: clearly feasible, and the firmware was explicitly designed for it.**
The DSPi external control interface (fw 1.1.5) exposes the *entire* vendor
command surface over UART with full parity to USB, including asynchronous
notifications and bulk snapshot transfer. An ESP32 wired to two GPIOs can
therefore act as a transparent WiFi front-end: a small HTTP/WebSocket server
that frames REST calls into UART requests. No firmware changes are needed on
the DSPi side; the console gains an optional WiFi transport almost for free
(section 4.2).

---

## 1. The DSPi UART control interface, as implemented

Sources: `Documentation/Features/control_interfaces_spec.md` (self-contained
665-line integrator spec — the firmware authors wrote it *for exactly this
use case*: "written for a firmware integrator building an ESP32, STM32,
Arduino, or SBC controller"), `firmware/DSPi/uart_control.c/.h`,
`firmware/DSPi/vendor_commands.h`.

### 1.1 Architecture: one command surface, three transports

The firmware has a transport-neutral dispatcher (`vendor_dispatch_get/set`).
USB EP0, UART, and I2C-target transports all parse their own framing into the
same `bRequest / wValue / wIndex / wLength` shape and call the same dispatch
switch. The consequence the spec calls out in bold:

> **Full parity.** Every vendor command works identically over USB, UART, and
> I2C ... Any command added to the firmware in the future is automatically
> available on all three transports with nothing per-transport to implement.

So everything the web console can do over WebUSB — EQ, matrix, presets,
volume, input selection, psybass, ADAT, siggen, bulk get/set, even bootloader
entry — is reachable over two wires. Writes arriving over UART are tagged
`PARAM_SRC_UART` (8) in the USB notify stream, so a USB-connected console
correctly sees them as external changes (the console's external-change
classification already passes unknown/other sources through).

**The single exception:** `REQ_SET_UART_CONFIG` (0xF5) and
`REQ_SET_I2C_CONFIG` (0xF7) are refused over the external transports with
`CTRL_STATUS_BLOCKED`. An external controller can never reconfigure, move, or
disable the transport it is talking on — it cannot lock itself out. Interface
configuration is a one-time USB step (section 3.2).

The UART module itself is carefully non-invasive: the ISR only moves bytes
into a 256-byte ring; all parsing, dispatch, and TX happen in
`uart_ctrl_poll()` from the main loop. The audio pipeline is never touched.

### 1.2 Link parameters

| Property | Value |
|---|---|
| Logic level | 3.3 V (ESP32-native, no level shifting) |
| Framing | fixed 8N1 (parity deliberately omitted; CRC16 covers integrity) |
| Baud | configurable 9600 – 1 000 000, default 115 200 |
| Duplex | full; request/response plus optional unsolicited notify frames |
| Default pins | TX = GPIO 16, RX = GPIO 17 (any valid UART-mux pair works: TX pin % 4 == 0, RX pin % 4 == 1, same UART instance) |

### 1.3 Frame format

Every frame starts with sync `0xA5` and a type byte; all multi-byte fields are
little-endian:

```
Request SET   : A5 01 bReq wValL wValH wIdxL wIdxH wLenL wLenH payload[wLen] crcL crcH
Request GET   : A5 02 bReq wValL wValH wIdxL wIdxH wLenL wLenH               crcL crcH
Response SET  : A5 81 status lenL lenH                                       crcL crcH
Response GET  : A5 82 status lenL lenH payload[len]                          crcL crcH
Notification  : A5 40 00 lenL lenH packet[len]                               crcL crcH
```

- `wIdx` is a pass-through; send 0 except for the few commands that use it.
  `wValue` carries per-command packing (channel, slot, `(pair<<8)|GPIO`, ...)
  exactly as over USB — every wValue encoding the console already implements
  in `wireCmd.ts` / `DspDevice.ts` transfers verbatim.
- On a GET, `wLen` caps the response size (0 = uncapped).
- CRC16-CCITT-FALSE (poly 0x1021, init 0xFFFF, no reflection, no final XOR)
  over everything after the sync byte, transmitted LE. Reference vector:
  `"123456789"` → `0x29B1`.
- Noise/desync recovery: unknown bytes are dropped; the parser resyncs on the
  next `0xA5`. Mid-frame inter-byte timeout is 100 ms; a truncated frame
  parks a `FRAME_ERROR` response.

### 1.4 Response status codes

| Code | Name | Bridge handling (see 5.4) |
|---|---|---|
| 0x00 | `CTRL_STATUS_OK` | success |
| 0x01 | `CTRL_STATUS_BUSY` | USB control SET in flight; retry whole request |
| 0x02 | `CTRL_STATUS_ERROR` | unknown command / dispatcher-level reject |
| 0x03 | `CTRL_STATUS_BLOCKED` | USB-only command (0xF5/0xF7) over UART |
| 0x04 | `CTRL_STATUS_BULK_LOCKED` | bulk buffer owned by another transport; retry |
| 0x05 | `CTRL_STATUS_CRC_ERROR` | request failed CRC; resend |
| 0x06 | `CTRL_STATUS_OVERSIZE` | non-bulk payload > 64 B |
| 0x07 | `CTRL_STATUS_FRAME_ERROR` | malformed/truncated frame |

**The OK-on-SET caveat (important for API semantics):** `OK` on a SET
confirms dispatch, *not* application. A recognized command whose payload
fails the handler's own validation is silently ignored and still answers OK —
identical to USB semantics. Positive confirmation = follow the SET with the
matching GET (the same write-to-readback contract the console already uses).
The REST layer should bake this in (section 5.4).

### 1.5 Discipline and timing

- **One request in flight.** No pipelining; overlapping requests is
  undefined. The bridge must serialize all UART traffic behind a queue.
- **Dispatch is main-loop, not ISR.** Normal latency ≈ one main-loop
  iteration. The UART module retries transient `BUSY`/`BULK_LOCKED`
  dispatches internally for up to 50 ms before answering.
- **Flash blackout.** Any flash-writing command (preset save/load/delete,
  factory reset, config SETs, persisting bulk apply) disables interrupts for
  ~45 ms; UART bytes sent into that window can be lost. Client contract:
  generous timeouts (hundreds of ms), retry on timeout/BUSY/CRC, and don't
  pipeline a request right behind a flash-writing command.
- **Payload caps.** Non-bulk SET payloads ≤ 64 B; non-bulk GET responses are
  ≤ 64 B by construction (the dispatcher's response buffer is 64 B; every
  per-parameter response fits — the largest live status packets are ~41 B).
  Only bulk (below) exceeds this, via its own path.

### 1.6 Bulk transfers (0xA0 / 0xA1)

`REQ_GET/SET_ALL_PARAMS` move the entire `WireBulkParams` blob in a single
framed transfer. The UART parser streams a bulk SET payload directly into the
shared `bulk_param_buf` under a cross-transport lock (`BULK_LOCKED` when USB
or I2C holds it; external owners go stale after 500 ms). At the current wire
format **V24 the blob is 5900 bytes**; wire time at 8N1 (~10 bits/byte):

| Baud | ~5.9 KB bulk frame |
|---|---|
| 115 200 | ~0.51 s |
| 460 800 | ~0.13 s |
| 921 600 | ~64 ms |
| 1 000 000 | ~59 ms |

The chunked variants (0xA2/0xA3) exist for the WinUSB 4 KB control-transfer
cap and are unnecessary over UART. For interactive control use per-parameter
commands; bulk is for snapshot/restore. Run a high baud to keep the
lock-hold window short.

### 1.7 Asynchronous notifications over UART

This is the piece that makes a *live* web bridge possible without polling.
Opt-in via `UartCtrlConfig.notify_enable` (set over USB at provisioning
time). When enabled, the device pushes type-`0x40` frames carrying the
**verbatim v2 notify packet** — byte-identical to what the USB notify
endpoint (EP 0x83) delivers, so the console's existing `protocol/notify.ts`
decoder applies unchanged. Parameter changes, preset loads, input-format
changes, siggen/ADAT/I2S-slave state, IR learn — all of it.

- **Idle-priority rule:** notify frames are sent only at frame boundaries
  while the link is idle; they never split or delay a response.
- **Recovery contract:** each v2 packet carries an 8-bit `seq`; a gap means
  events were dropped for this consumer → re-sync with a full
  `REQ_GET_ALL_PARAMS`. The bridge should implement this and surface a
  `resync` event to web clients.
- The v1 legacy master-volume packet is never sent over UART; v2 only.

(I2C, by contrast, is poll-only — no target-initiated transfers. UART is the
right transport for this project; I2C is not considered further.)

### 1.8 Provisioning, persistence, boot

- Ships **disabled**; holds no pins until enabled.
- One-time setup over USB: `REQ_SET_UART_CONFIG` (0xF5) with 8-byte
  `UartCtrlConfig {enabled, tx_pin, rx_pin, notify_enable, baud u32}`.
  Returns a `PIN_CONFIG_*` status; applied live from the main loop, persisted
  to the preset directory only on success. Readback: 0xF6 (config),
  0xF9 (`CtrlIfaceStatus` — last status, live flag, protocol version).
- Config is device-level (not part of presets or `WireBulkParams`) and
  **survives factory reset**.
- At boot the interface comes up after output/RX/MCK/DAC-mute pins are
  claimed; a stored config whose pins now collide stays down (`enabled==1`
  but `uart_live==0` via 0xF9) — detectable divergence.
- A live UART interface reserves its pins in `is_pin_in_use`, so output/pin
  commands can't steal them. (Console note: `pins.ts` still has a static
  gen-16 reservation of GPIO 16/17; FW-TODO already tracks replacing it with
  config-driven reservation.)

The console already has the full provisioning surface in
`wireCmd.ts` (`SetUartConfig`/`GetUartConfig`/`GetCtrlIfaceStatus`) — a small
System-tab panel is all that's missing to provision a bridge without any
other tooling.

---

## 2. Feasibility assessment

| Concern | Assessment |
|---|---|
| Electrical | Direct 3.3 V connection, 3 wires (TX, RX, GND). No level shifting. |
| ESP32 UART | Any ESP32 (classic/S3/C3) has ≥2 hardware UARTs with arbitrary GPIO routing and supports 921 600 / 1 000 000 baud comfortably. |
| Protocol complexity | Trivial: 11-byte header framing + table-driven CRC16. The firmware spec includes worked byte-level examples and a CRC test vector. |
| Latency | At 921 600 baud a typical command is ~24 bytes round trip ≈ 0.3 ms wire + ~1 main-loop iteration dispatch. WiFi/HTTP RTT (2–10 ms) dominates. Interactive fader-drag rates are no problem with per-parameter commands. |
| Throughput | Full 5.9 KB snapshot in ~64 ms at 921 600. |
| Live updates | UART notify frames push the same v2 packets USB gets → WebSocket/SSE to browsers with no polling. |
| Command coverage | 100 % of the vendor surface except the two self-config SETs (0xF5/0xF7, deliberate) — see parity table in 5.6. |
| Risk: flash blackout | ~45 ms deaf window after flash writes; handled with timeouts + retries + a post-flash quiet period in the bridge queue. |
| Risk: contention | Single bulk buffer shared with USB; `BULK_LOCKED` retry loop handles it. One-request-in-flight is a bridge-side queue, not a limitation for a single-box bridge. |
| Risk: baud validation | 921 600 is within the 9600–1M accepted range; RP2040/RP2350 UART dividers hit it exactly. |

Recommended link config: **enabled=1, tx=16, rx=17 (defaults), baud=921600,
notify_enable=1**.

Suggested hardware: ESP32-S3 (dual-core: one core owns the UART client +
queue, the other the WiFi/HTTP stack) or ESP32-C3 for minimum BOM. Power from
the same 5 V rail as the DSPi. ESP-IDF `esp_http_server` provides HTTP +
WebSocket in one component; mDNS (`dspi.local`) for discovery.

---

## 3. Bridge architecture

```
                    ESP32
  ┌───────────────────────────────────────────┐
  │  WiFi (STA or AP)                         │
  │  ┌───────────────┐   ┌────────────────┐   │        3 wires        DSPi
  │  │ HTTP server   │   │ UART client    │   │   ┌──────────────┐  ┌───────┐
  │  │  REST /api/v1 │──▶│  request queue │───┼──▶│ TX ──▶ RX 17 │  │ RP2350│
  │  │  WS /ws/*     │◀──│  1 in flight   │◀──┼───│ RX ◀── TX 16 │  │       │
  │  └───────────────┘   │  CRC + retry   │   │   │ GND ─── GND  │  └───────┘
  │        ▲             │  notify parser │   │   └──────────────┘
  │        └── events ───┘                │   │
  └───────────────────────────────────────────┘
```

Components:

1. **UART client task.** Owns the port exclusively. Pulls requests from a
   FIFO queue, frames + CRCs them, enforces one-in-flight with a per-request
   timeout (default 300 ms; 1.5 s for bulk and flash-writing opcodes), and
   retries on timeout / `BUSY` / `BULK_LOCKED` / CRC (bounded, with backoff).
   After any flash-writing opcode it inserts a ~100 ms quiet period.
   Between responses it parses incoming `0x40` frames, verifies CRC, tracks
   `seq`, and hands packets to the event fan-out. On a seq gap it schedules a
   bulk re-read and emits `resync`.
2. **Request queue with priorities.** Interactive SETs (volume, mute, EQ)
   ahead of background polls; bulk transfers lowest. Coalescing rule: if a
   newer SET for the same (bReq, wValue) is queued, drop the older one —
   absorbs fader-drag bursts without lag.
3. **HTTP/REST layer.** Stateless translation of resources to vendor
   commands (section 5). Handlers enqueue and await.
4. **WebSocket layer.** `/ws/tunnel` (raw vendor pass-through, section 4.2)
   and `/ws/events` (decoded notifications, section 5.5).
5. **Optional state cache (phase 2).** Because notifications report every
   external change, the bridge can keep a shadow copy of hot parameters and
   serve GETs from RAM, invalidating on notify. Phase 1 should be a pure
   proxy — correct first, fast later.

---

## 4. Web API: two layers

Two deliberately different API surfaces, both thin:

### 4.1 Layer 1: REST (`/api/v1/...`)

Human- and integration-friendly resources with JSON bodies, units in dB/Hz/ms,
and names instead of opcodes. Designed for parity of *expressiveness* with
the vendor surface (section 5).

### 4.2 Layer 2: raw vendor tunnel (`/ws/tunnel`)

The console's transport abstraction is exactly three calls
(`src/transport/DspTransport.ts`):

```ts
ctrlIn(request, value, length) → Uint8Array   // = UART GET frame
ctrlOut(request, value, data)  → void          // = UART SET frame
notifyIn?(length)              → Uint8Array    // = UART 0x40 frames
```

That is *precisely* the UART frame shape. A WebSocket endpoint that carries
`{id, op: "get"|"set", bReq, wValue, wIndex, payload}` (binary or
JSON+base64) plus server-pushed notify packets is a complete, zero-translation
transport. **A ~100-line `WsTransport implements DspTransport` in the console
makes the entire existing web console work over WiFi unchanged** — every
codec, every feature gate, every UI surface. This is the highest-leverage
deliverable of the whole project and should be specified as a hard
requirement of the bridge firmware.

Tunnel message format (JSON variant):

```jsonc
// client → bridge
{ "id": 17, "op": "get", "bReq": 211, "wValue": 0, "wIndex": 0, "len": 4 }
{ "id": 18, "op": "set", "bReq": 210, "wValue": 0, "wIndex": 0, "payload": "AAAAoME=" }
// bridge → client
{ "id": 17, "status": 0, "payload": "AAAAoME=" }
{ "id": 18, "status": 0 }
// unsolicited (verbatim v2 notify packet)
{ "event": true, "packet": "AgQAKw==" }
```

`status` is the raw `CTRL_STATUS_*` byte; the client treats non-zero like a
USB STALL. The bridge serializes tunnel and REST traffic through the same
queue, so both can be used concurrently.

---

## 5. REST API design

### 5.1 Conventions

- Base `http://dspi.local/api/v1`. JSON everywhere except `/snapshot`
  (binary). All floats are engineering units: dB, Hz, ms, percent.
- **Channel model** mirrors wire V16+: one unified index space,
  `channels 0..N-1` = `[inputs 0..Nin-1][outputs Nin..N-1]`
  (RP2350: 8 in + 9 out = 17; RP2040: 2 + 5 = 7). Convenience aliases
  `/inputs/{i}` and `/outputs/{k}` map to channel `i` and `Nin + k`;
  output-scoped vendor ops (gain/mute/delay/enable, crossover) live under
  `/outputs`, unified ops (EQ, name) under `/channels`.
- `GET` = live read from the device (phase 1). `PUT` = full value,
  `PATCH` = partial object update (bridge fans out to the per-field vendor
  SETs). Every write response returns the **read-back** state (5.4).
- Destructive/persistent actions are `POST` and require `{"confirm": true}`.

### 5.2 Resource map

Complete mapping of the vendor surface (opcode references = `wireCmd.ts`
names). RP2350-only resources return `404` with `{"error":"unsupported"}` on
RP2040, mirroring the firmware's own platform gates.

**Device and status**

| Endpoint | Methods | Vendor commands |
|---|---|---|
| `/device` | GET | GetSerial 0x7E, GetPlatform 0x7F, GetCtrlIfaceStatus 0xF9 → `{serial, platform, fw, wire, protoVersion}` |
| `/status` | GET | GetStatus 0x50 wValue=9 → `{peaks[], cpu0, cpu1, clipFlags, activeInputs}` |
| `/status/clips` | DELETE | ClearClips 0x83 (read-then-clear; response body carries the flags) |
| `/status/buffers` | GET, DELETE | GetBufferStats 0xB0 / ResetBufferStats 0xB1 |

**Volume and channels**

| Endpoint | Methods | Vendor commands |
|---|---|---|
| `/volume` | GET, PUT | Set/GetMasterVolume 0xD2/0xD3 `{db}` |
| `/volume/mode` | GET, PUT | 0xD4/0xD5 (`independent` \| `withPreset`) |
| `/volume/saved` | GET, POST | GetSavedMasterVolume 0xD7 / SaveMasterVolume 0xD6 |
| `/volume/user` | GET, PUT | SetUserVolume/Mute 0xDA–0xDD `{db, mute}` |
| `/bypass` | GET, PUT | Set/GetBypass 0x46/0x47 (master EQ bypass) |
| `/channels/{ch}` | GET | aggregate: name + EQ + role |
| `/channels/{ch}/name` | GET, PUT | 0x9B/0x9C (≤31 chars) |
| `/channels/{ch}/eq/{band}` | GET, PUT, PATCH | SetEqParam 0x42 (16-B packet, +2-B Qp sidecar for Linkwitz Transform), GetEqParam 0x43 params 0–5; band bypass 0xD8/0xD9. Body `{type, freq, q, gainDb, bypass, qp?}` |
| `/inputs/{i}/preamp` | GET, PUT | 0xD0/0xD1 (wValue = channel) |

**Matrix and outputs**

| Endpoint | Methods | Vendor commands |
|---|---|---|
| `/matrix` | GET | fan-out GetMatrixRoute 0x71 over live inputs × outputs |
| `/matrix/{in}/{out}` | GET, PUT, PATCH | 0x70/0x71 `{enabled, phaseInvert, gainDb}` |
| `/outputs/{k}` | GET, PATCH | enable 0x72/0x73, gain 0x74/0x75, mute 0x76/0x77, delay 0x78/0x79 → `{enabled, gainDb, mute, delayMs}` |
| `/outputs/{k}/crossover/{i}` | GET, PUT | EQ opcodes at wire band `20+i` (i = 0..3), crossover filter types 32–63 |

**Processing blocks** (each a single JSON object; PATCH fans out to
per-field SETs)

| Endpoint | Fields → vendor commands |
|---|---|
| `/processing/loudness` | enabled 0x58, refSpl 0x5A, intensity 0x5C, outputMask 0xFA/0xFB |
| `/processing/crossfeed` | enabled 0x5E, preset 0x60, freq 0x62, feedDb 0x64, itd 0x66, pairMask 0xFC/0xFD |
| `/processing/leveller` | enabled 0xB4, amount 0xB6, speed 0xB8, maxGain 0xBA, lookahead 0xBC, gate 0xBE, masks 0xDE/0xDF `{detector, apply}` |
| `/processing/psybass` | enabled/cutoff/harmonics/drive/character/original/mask 0x30–0x3D (RP2350) |

**Input routing**

| Endpoint | Methods | Vendor commands |
|---|---|---|
| `/input/source` | GET, PUT | 0xE0/0xE1 (`usb`\|`spdif`\|`i2s`\|`adat`\|`spdif2`\|`spdif3`) |
| `/input/rate` | GET, PUT | SetInputRate 0xED (u32 Hz), GetInputRate 0xEE `{currentHz, selectedHz}`; PUT rejected with 409 while a slave clock mode is active (device is not rate authority) |
| `/input/spdif` | GET | GetSpdifRxStatus 0xE2, GetSpdifRxChStatus 0xE3, GetSpdifInputConfig 0xEF |
| `/input/spdif/{idx}` | PATCH | SetSpdifRxPin 0xE4 `(idx<<8)\|gpio`, SetSpdifInputEnable 0xE9 |
| `/input/i2s` | GET, PATCH | rx pins 0xF1/0xF2 (pair-indexed), channels 0xF3/0xF4, clock mode 0x88/0x89, clock-pin mode 0xFE/0xFF, BCK pin 0xC2/0xC3 (role-indexed) |
| `/input/i2s/status` | GET | GetI2sSlaveStatus 0x8A (16-B lock status) |
| `/input/adat` | GET, PATCH | enable 0x68/0x69, pin 0x6A/0x6B, clock mode 0x6C/0x6D (RP2350) |
| `/input/adat/status` | GET | GetAdatInputStatus 0x6E (20-B packet, decoded) |
| `/input/lg-sound-sync` | GET, PATCH | 0xE6/0xE7/0xE8 |

**Presets and persistence**

| Endpoint | Methods | Vendor commands |
|---|---|---|
| `/presets` | GET | PresetGetDir 0x95 + PresetGetName 0x93 per occupied slot + PresetGetActive 0x9A |
| `/presets/{slot}` | PUT, DELETE | PresetSave 0x90 (+ PresetSetName 0x94), PresetDelete 0x92 |
| `/presets/{slot}/load` | POST | PresetLoad 0x91 |
| `/presets/startup` | GET, PUT | 0x96/0x97 `{mode, slot}` |
| `/presets/output-config-mode` | GET, PUT | 0x98/0x99 |
| `/system/save` | POST | SaveParams 0x51; SaveOutputConfig 0x52 as `{scope:"outputConfig"}` |
| `/system/factory-reset` | POST | FactoryReset 0x53 (confirm required) |
| `/system/bootloader` | POST | EnterBootloader 0xF0 (confirm required; see 5.6) |

**Snapshot (bulk)**

| Endpoint | Methods | Vendor commands |
|---|---|---|
| `/snapshot` | GET, PUT | GetAllParams 0xA0 / SetAllParams 0xA1, `application/octet-stream`, exact wire blob (5900 B at V24). The bridge does not parse it — version-exactness stays end-to-end between producer and device. `X-DSPi-Wire-Version` response header from the blob's own header. |

**Hardware config** (pins, output types, MCK — the `PinConfigResult`
action-IN family 0x7C/0x7D, 0xC0–0xC9, DAC-mute 0xEA–0xEC): grouped under
`/hw/outputs/{k}/pin`, `/hw/i2s`, `/hw/dac-mute`. Same GET/PATCH pattern;
status bytes map per 5.4. Rarely used from WiFi but included for parity.

**Control surfaces** (0x84–0x8F, 0x9D/0x9E): `/cs/bindings/{slot}`,
`/cs/caps`, `/cs/status`, `/cs/ir/{sub}`, `/cs/ir/learn`, `/cs/save`,
`/cs/revert`. Deferred-apply semantics surface as `202 Accepted` +
poll `/cs/status` (or wait for the notify event), mirroring the firmware's
own PENDING model.

**Signal generator** (0xA4–0xA8): `/siggen/config` (GET/PUT, 36-B
`SiggenConfig` as JSON), `/siggen` POST `{action: "start"|"stop"|"stopNow"}`,
`/siggen/status`, `/siggen/caps`.

**Escape hatch**

| Endpoint | Purpose |
|---|---|
| `/vendor` POST `{op, bReq, wValue, wIndex, payload?, len?}` | Raw pass-through, same shape as the WS tunnel. Guarantees the REST layer never *blocks* access to a future firmware command (parity by construction, like the transports themselves). |

### 5.3 Examples

```
GET /api/v1/volume                    → 200 {"db": -20.0}
PUT /api/v1/volume {"db": -22.5}      → 200 {"db": -22.5}            (read back)

PATCH /api/v1/outputs/3 {"mute": true}
  → 200 {"enabled": true, "gainDb": -3.0, "mute": true, "delayMs": 0.25}

PUT /api/v1/channels/9/eq/2
  {"type": "linkwitzTransform", "freq": 55, "q": 0.9, "gainDb": 30, "qp": 0.5}
  → 200 (gainDb carries fp in Hz for LT, as on the wire; qp defaults 0.707)

POST /api/v1/presets/2/load {"confirm": true}
  → 200 {"active": 2}                  (after the flash blackout + readback)

GET /api/v1/input/adat/status
  → 200 {"state": "locked", "clockMode": "slave", "detectedRate": 48000,
         "lockCount": 3, "lossCount": 1, "measuredHz": 47998, ...}
```

### 5.4 Error and status mapping

| Condition | HTTP |
|---|---|
| `BUSY` / `BULK_LOCKED` after bridge-internal retries (~1 s budget) | `503` + `Retry-After` |
| `ERROR` (dispatcher reject) | `400` `{error, ctrlStatus}` |
| `BLOCKED` (only reachable via `/vendor` with 0xF5/0xF7) | `403` |
| CRC/frame errors persisting after retransmits | `502` |
| UART timeout (device unresponsive / flash window) | `504` |
| Action status byte ≠ success (`PinConfigResult`, `FlashResult`, `PresetResult`) | `422` `{error, statusByte, statusName}` — e.g. `{"statusName": "PIN_CONFIG_PIN_IN_USE"}` |
| Unknown resource / RP2350-only on RP2040 | `404` |
| Value out of documented range (bridge-side pre-validation) | `400` before touching the UART |

Because of the OK-on-SET caveat (1.4), every REST write is implemented as
SET → GET → compare; the response body is the read-back state. If the
readback differs from the request (firmware silently rejected or clamped),
the bridge returns `409 Conflict` with `{requested, applied}` — turning the
firmware's silent-ignore into a visible, actionable signal without changing
device semantics.

### 5.5 Events: `/ws/events` (and SSE fallback `/api/v1/events`)

The bridge decodes each v2 notify packet (same schema as
`src/protocol/notify.ts`) and pushes JSON:

```jsonc
{ "kind": "paramChanged", "seq": 43, "source": "usb", "offset": 132, "len": 4 }
{ "kind": "presetLoaded", "seq": 44, "slot": 2 }
{ "kind": "inputFormat",  "seq": 45, "channels": 8 }
{ "kind": "adatInputState", "seq": 46, "state": "locked", "rateHz": 48000, "clockMode": "slave" }
{ "kind": "resync" }   // bridge detected a seq gap; re-read state
```

Raw packet bytes ride along base64 for clients that already have a v2
decoder. Bridge-side seq-gap handling: emit `resync`, refresh the phase-2
cache via bulk read; clients without state can ignore it.

### 5.6 Expressiveness parity audit

| Vendor surface | Over UART? | In REST? | Notes |
|---|---|---|---|
| EQ / crossover / names / matrix / outputs / volume / bypass | yes | yes | |
| Input routing incl. SPDIF×3, I2S (+slave clock), ADAT, rates | yes | yes | |
| Loudness / crossfeed / leveller / psybass | yes | yes | |
| Presets, startup, save, factory reset | yes | yes | flash-blackout handling in queue |
| Bulk snapshot 0xA0/0xA1 | yes (one frame) | yes (`/snapshot`) | chunked 0xA2/0xA3 not needed on UART |
| Live status/meters, buffer stats | yes | yes | meters via polling `/status`; see below |
| Notifications | yes (type 0x40) | yes (WS/SSE) | full v2 catalogue |
| Control surfaces, IR learn | yes | yes | deferred-apply → 202 + status poll |
| Signal generator | yes | yes | |
| Pin/hw config, DAC mute | yes | yes | `PinConfigResult` → 422 mapping |
| UART/I2C self-config SET 0xF5/0xF7 | **no** (BLOCKED) | read-only mirror | by design; provisioning stays on USB |
| EnterBootloader 0xF0 | yes | yes | reboots into USB BOOTSEL: the UART link dies with it and flashing happens over USB. Works, but of limited use remotely — document as "last command you'll send". |
| GetSpdifRxChStatus 0xE3, chunk cmds | yes | via `/vendor` | niche; escape hatch covers them |

Two genuine semantic gaps versus the console-over-USB experience, both
manageable:

1. **Meter streaming.** The console polls `GetStatus` at UI rate over USB.
   Over the bridge each poll is HTTP + UART (~41 B response, trivially fast);
   the bridge should poll internally (e.g. 10–15 Hz, only while at least one
   `/ws/events` client subscribes to `meters`) and push over the WS — cheaper
   than per-client HTTP polling and keeps the UART queue disciplined.
2. **Multi-client writes.** Multiple web clients + a USB host can write
   concurrently. This is exactly the situation notifications exist for
   (`PARAM_SRC_*` attribution); the bridge stays stateless per-request and
   lets clients reconcile via events, like the console already does for
   external changes.

---

## 6. Open questions / next steps

1. **Console provisioning panel.** Small System-tab UI over the existing
   `SetUartConfig`/`GetCtrlIfaceStatus` commands (enable, pins, baud,
   notify), plus live/collision indication. Prerequisite for everything else.
2. **`WsTransport` in the console.** Implement `DspTransport` over
   `/ws/tunnel` (+ a connect dialog for host discovery via mDNS). This makes
   the full console usable over WiFi before any REST work starts, and is the
   cheapest way to validate the bridge end-to-end.
3. **Bridge firmware skeleton.** ESP-IDF project: UART client task + queue +
   CRC (validate against the `0x29B1` vector and the spec's worked master-
   volume example), then `/ws/tunnel`, then REST resources incrementally.
4. **Ordering/priority policy.** Confirm coalescing rules per opcode family
   (volume/EQ scrub coalesce; preset/save never coalesce and flush the queue).
5. **Security model.** LAN-only assumption vs. token auth on `/api` + WS;
   AP-mode provisioning flow for headless setup.
6. **Verify on hardware.** UART behavior around the flash blackout window
   (timeout tuning), bulk at 921 600 baud, notify starvation under load, and
   the `uart_live==0` boot-collision path.
7. **Phase 2 cache.** Notify-invalidated parameter cache in the bridge to cut
   UART round trips for GET-heavy REST clients; needs the seq-gap resync path
   solid first.
