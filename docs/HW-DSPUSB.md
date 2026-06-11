# DSPi USB Interface

All communication is **vendor-class control transfers** on a claimed interface, plus (firmware ≥ 1.1.4) a bulk-IN notify endpoint `0x83` on the same interface — see `HW-NOTIFICATIONS.md`. No streaming.

### Identity

- **VID / PID**:
  - `0x2E8A / 0xFEAA` — RP-Pico vendor block, used by firmware **≤ v1.1.3**.
  - `0x2E8B / 0xFEAA` — Weeb Labs–owned vendor block, used by firmware **≥ v1.1.4** (released v1.1.4, `firmware/DSPi/usb_descriptors.h` defines `USB_VENDOR_ID = 0x2E8B`). PID is unchanged.
  - Both pairs must be listed in `navigator.usb.requestDevice` filters; see `docs/FW-VERSIONS.md` § "USB identity migration".
- **Interface class**: `0xFF` (vendor)
- **Interface number**: auto-discovered by class match; legacy hard-coded fallback `2`
- **Control transfer type**: `requestType: 'vendor', recipient: 'interface'`

### Transport implementations

| Implementation | File | Use |
|---|---|---|
| `WebUsbTransport` | `src/transport/WebUsbTransport.ts` | Production (browser via `navigator.usb`) |
| `MockTransport` | `src/transport/MockTransport.ts` | Unit/integration tests; `?mock=rp2040` / `?mock=rp2350` dev URL |
| `NodeUsbTransport` | `src/transport/NodeUsbTransport.ts` | Hardware-in-the-loop (HIL) tests via libusb |

All implement `DspTransport`:

```ts
interface DspTransport {
  open(): Promise<void>;
  close(): Promise<void>;
  isOpen(): boolean;
  ctrlIn(req: number, wValue: number, length: number): Promise<Uint8Array>;
  ctrlOut(req: number, wValue: number, data: Uint8Array | null): Promise<void>;
  on(event: 'connect' | 'disconnect', fn: () => void): () => void;
}
```

The transport surface only exposes `wValue` (no `wIndex`). Commands that need two indices (e.g., matrix route by `(input, output)`) pack both into `wValue` — see `WireCmd.GetMatrixRoute`.

`'connect'` is emitted **synchronously** from inside `WebUsbTransport.open()` — registered listeners fire before `requestAndOpen()`'s caller sees the promise resolve. Runtime connection code attaches listeners only after `DspDevice.create(...)` completes, then explicitly calls `finishConnection(...)` for the initial snapshot.

### MockTransport behavior

- Returns a synthesized V6 bulk packet via `synthesizeBulkParams`.
- Returns a deterministic status packet (peak sweep across channels).
- Returns a 44-byte buffer-stats packet with `streaming=1, pdmActive=1`.
- Echoes master-volume / preamp / input-preamp writes back to readers.
- Constructor option `{ platform: 'rp2040' | 'rp2350' }` flips header values + channel counts.

## Vendor commands

Defined in `src/protocol/wireCmd.ts`. Each entry has an opcode + an optional codec. The `readCmd` / `writeCmd` helpers wrap `ctrlIn` / `ctrlOut` with codec-aware (de)serialization.

Codecs: scalars in `binCodec.ts` (`u8`, `i8`, `u16`, `i16`, `u32`, `i32`, `f32`, `bool8`). Composite packets use struct codecs from `wireTypes.ts`.

### Identity & introspection

| Code | Name | Direction | Codec | Use |
|---|---|---|---|---|
| `0x7E` | `GetSerial` | IN | UTF-8 string | Device serial; once per connect |
| `0x7F` | `GetPlatform` | IN | `DeviceInfo` struct | `{ platformId, fwMajor, fwMinorPatch }` |
| `0xA0` | `GetAllParams` | IN | (raw bytes → `parseBulkParams`) | The bulk packet — see §Bulk packet |

### Status & telemetry

| Code | Name | wValue | Direction | Returns |
|---|---|---|---|---|
| `0x50` | `GetStatus` | `9` | IN | `numCh × u16 peaks + u8 cpu0 + u8 cpu1 + u16 clipFlags` |
| `0x50` | `GetStatus` | `wValue ≠ 9` | IN | `u32` or `i32` per-counter values (see `SystemStatusValue`) |
| `0xB0` | `GetBufferStats` | `0` | IN | 44-byte buffer-health packet |
| `0x83` | `ClearClips` | `0` | OUT | Clears latched clip flags |
| `0xB1` | `ResetBufferStats` | `1` | IN | Echoes `0x01` on success; resets min/max watermarks |

`GetStatus` is overloaded: `wValue=9` returns the peak-sweep packet (polled at ~20 Hz from `poll.ts`), other `wValue` codes return individual counters (clock, voltage, temp, error counts) polled at ~1 Hz via `getSystemInfo()` using `Promise.allSettled` so a single STALL on one counter doesn't blank the whole panel. See `docs/system-status-req.md` for the full counter list.

### EQ filter

| Code | Name | Direction | Codec | Use |
|---|---|---|---|---|
| `0x42` | `SetEqParam` | OUT | 16-byte `SetEqParam` payload | One band write |
| `0x43` | `GetEqParam` | IN | (not used by production code; bulk read covers it) | — |

`SetEqParam` payload (`Wire.SetFilterPacket` codec, dispatched by `WireCmd.SetEqParam` via `writeCmd`): `u8 channel, u8 band, u8 type, u8 _reserved, f32 freq, f32 Q, f32 gain` — the entire band as a tuple, not per-field. There is no per-band getter; reads come from the bulk packet only.

### Mixer / output / preamp

The "core mixer" surface — every settable field has a matching dedicated getter AND is in the bulk packet. HIL tests cross-check the two paths.

| Codes (set/get) | Group | Per-target indexing | Bulk field |
|---|---|---|---|
| `0xD2 / 0xD3` | Master volume | — | `masterVolumeDb` (V6+) |
| `0x44 / 0x45` | Master preamp | — | `preampDb` |
| `0xD0 / 0xD1` | Input preamp | `wValue = channel ∈ {0,1}` | `preampLDb`, `preampRDb` (V6+) |
| `0x70 / 0x71` | Matrix route | `wValue = (input << 8) \| output` | `crosspoints[in][out]` |
| `0x72 / 0x73` | Output enable | `wValue = output` | `outputs[out].enabled` |
| `0x76 / 0x77` | Output mute | `wValue = output` | `outputs[out].muted` |
| `0x74 / 0x75` | Output gain | `wValue = output` | `outputs[out].gainDb` |
| `0x78 / 0x79` | Output delay | `wValue = output` | `outputs[out].delayMs` |

**Matrix route always writes the full tuple** `{ enabled, invert, gainDb }`. Callers that change one field must merge with the current snapshot before sending. `setCrosspointGain` re-reads from `dsp.live` at fire time for exactly this reason.

### Feature configs (set-only, bulk-read-only)

These groups have setters but no per-field getters. Reads come from the bulk packet.

| Codes (set) | Group | Fields |
|---|---|---|
| `0x58, 0x5A, 0x5C` | Loudness | enabled, refSpl, intensityPct |
| `0x5E, 0x60, 0x62, 0x64, 0x66` | Crossfeed | enabled, preset, freq, feedDb, itd |
| `0xB4, 0xB6, 0xB8, 0xBA, 0xBC, 0xBE` | Volume Leveller | enabled, amount, speed, maxGainDb, lookahead, gateDb |

The Leveller block in the bulk packet is V4+ optional — `null` on older firmware. The other two groups are present from V2.

### Persistence and presets

`DspDevice` exposes the full preset wire surface plus the legacy persistence trio. State-runtime/UI integration is the next layer; see `HW-TODO.md §3` and `HW-PROFILES.md §6`.

| Codes | Group | Method | Returns |
|---|---|---|---|
| `0x51 / 0x53` | `SaveParams` / `FactoryReset` | `saveParams` / `factoryReset` | `Result<void, FlashResult>` |
| `0x52` | `SaveOutputConfig` (1.1.4+; was `LoadParams` ≤ 1.1.3 — removed) | `saveOutputConfig` (V10-gated) | `Result<void, PresetResult>` |
| `0x83` | `ClearClips` | `clearClips` | `void` |
| `0xB1` | `ResetBufferStats` | `resetBufferStats` | `boolean` |
| `0x9B / 0x9C` | `SetChannelName` / `GetChannelName` | `setChannelName` / `getChannelName` | UTF-8 string |
| `0x90 / 0x91 / 0x92` | `PresetSave` / `PresetLoad` / `PresetDelete` | `savePreset` / `loadPreset` / `deletePreset` | `Result<void, PresetResult>` |
| `0x93 / 0x94` | `PresetGetName` / `PresetSetName` | `getPresetName` / `setPresetName` | UTF-8 string |
| `0x95` | `PresetGetDir` | `getPresetDirectory` | `PresetDirectoryInfo` |
| `0x96 / 0x97` | `PresetSetStartup` / `PresetGetStartup` | `setPresetStartup` / `getPresetStartup` | `{mode, slot}` |
| `0x98 / 0x99` | Output-config persistence mode (fw: `SET/GET_OUTPUT_CONFIG_MODE`; `1=WITH_PRESET`, `0=INDEPENDENT` — wire-compatible with the old include-pins bool, but now governs output pins + output types + I2S BCK/MCK + SPDIF RX pin as one block) | `setOutputConfigMode` / `getOutputConfigMode` | `boolean` |
| `0x9A` | `PresetGetActive` | `getActivePreset` | `u8` (0xFF transient — coerce to 0) |
| `0xD4 / 0xD5` | Master volume mode | `setMasterVolumeMode` / `getMasterVolumeMode` | `MasterVolumeMode` |
| `0xD6 / 0xD7` | Save/get saved master volume | `saveMasterVolume` / `getSavedMasterVolume` | `boolean` / `f32` |
| `0x46 / 0x47` | Bypass | `setBypass` / `getBypass` | `boolean` |

### Pin / I2S clock surface

These are action-style IN commands (args in `wValue`, 1-byte status/value response). See `docs/PINS-CONFIG.md`.

| Codes | Group | Method | Notes |
|---|---|---|---|
| `0x7C / 0x7D` | Output pin | `setOutputPin` / `getOutputPin` | GPIO assignment per output slot |
| `0xC0 / 0xC1` | Output slot type | `setOutputType` / `getOutputType` | SPDIF↔I2S; returns `PinConfigResult` |
| `0xC2 / 0xC3` | I2S BCK pin | `setI2sBckPin` / `getI2sBckPin` | LRCLK = BCK + 1 |
| `0xC4 / 0xC5` | MCK enable | `setMckEnable` / `getMckEnable` | — |
| `0xC6 / 0xC7` | MCK pin | `setMckPin` / `getMckPin` | — |
| `0xC8 / 0xC9` | MCK multiplier | `setMckMultiplier` / `getMckMultiplier` | Wire encoding: `0=128×`, `1=256×` (V5+); see history below |

### Not yet wired

Firmware-defined commands with no `DspDevice` method yet. See `HW-TODO.md §1` for the backlog.

**Shipped firmware (≤ v1.1.3 main):**

| Codes | Group | Notes |
|---|---|---|
| `0x48 / 0x49` | Per-channel delay | Bulk-only `dsp.delaysMs[]` |
| `0x54 / 0x55` | Channel gain | Distinct from output gain |
| `0x56 / 0x57` | Channel mute | Distinct from output mute |
| `0xB2 / 0xB3` | USB error stats | `GetUsbErrorStats` / `ResetUsbErrorStats` — counter packet |
| `0xF0` | `EnterBootloader` | Jumps to ROM bootloader |

**v1.1.4+ only** — the console ships typed, capability-gated `DspDevice` methods for all of these; none are surfaced in runtime/UI yet:

| Codes | Group | Notes |
|---|---|---|
| `0xD8 / 0xD9` | Per-band EQ bypass | `wValue = (channel<<8) \| band`, 1-byte body. Also surfaced as the `bypass` byte at offset 1 of each `WireBandParams` and at offset 3 of the `SetEqParam 0x42` payload (was `reserved`). |
| `0xDA / 0xDB` | User volume | Vendor-channel host volume (`f32 dB`, clamped to `[-60, 0]`). Mirrors the same quantity as UAC1 host volume but always honored regardless of input source. |
| `0xDC / 0xDD` | User mute | Vendor mute (`u8 0/1`). OR'd with `audio_state.mute` (UAC1) in the pipeline but always honored regardless of input source. |
| `0xE0 / 0xE1` | Input source | `InputSource` enum: `0=USB`, `1=SPDIF`. |
| `0xE2` | `GetSpdifRxStatus` | 16-byte packet: `u8 state, u8 inputSource, u8 lockCount, u8 lossCount, u32 sampleRate, u32 parityErrors, u16 fifoFillPct, u16 _`. `state` = `SpdifInputState` enum (`0=Inactive`, `1=Acquiring`, `2=Locked`, `3=Relocking`). |
| `0xE3` | `GetSpdifRxChStatus` | 24-byte IEC 60958 channel-status block (raw). |
| `0xE4 / 0xE5` | SPDIF RX pin | `wValue` = GPIO; returns 1-byte status. |
| `0xE6 / 0xE7` | LG Sound Sync enable | Per-preset toggle. |
| `0xE8` | `GetLgSoundSyncStatus` | 16-byte packet: `u8 enabled, u8 present, u8 volume, u8 muted` (rest reserved). |
| `0xEA / 0xEB` | DAC HW mute config | 16-byte `WireDacHwMute` (enable, active-low, pin, hold/release ms). |
| `0xEC` | `TestDacHwMute` | No payload; pulses mute ~1s. |

1.1.4 also adds two new EQ filter types: `FILTER_NOTCH = 6` and `FILTER_ALLPASS = 7`.

Preset surface and persistence command reference: see `docs/HW-PROFILES.md`.

## Bulk packet layout — `GetAllParams 0xA0`

The largest packet on the wire and the structure most likely to drift between firmware revisions. Layout mirrors `DSPiConsole.Usb/BulkParamsParser.cs`. **Min size 2832 B (V2); max request size 2896 B (V6) on 1.1.3, 2960 B (V10) on released 1.1.4.**

| Offset | Size | Section | Contents |
|---|---|---|---|
| 0 | 16 | Header | `u8 version, u8 platformId, u8 numCh, u8 numOut, u8 numIn, u8 maxBands` (rest reserved) |
| 16 | 16 | Global | `f32 preampDb, u8 bypass, u8 loudnessEnabled, u16 _, f32 loudnessRefSpl, f32 loudnessIntensityPct` |
| 32 | 16 | Crossfeed | `u8 enabled, u8 preset, u8 itd, u8 _, f32 freq, f32 feedDb, u32 _` |
| 48 | 16 | (legacy channels) | Ignored |
| 64 | 44 | Per-channel delay | `f32 delaysMs[11]` |
| 108 | 144 | Crosspoints | `[2 inputs × 9 outputs] × { u8 enabled, u8 invert, u16 _, f32 gain }` (input-major) |
| 252 | 108 | Outputs | `9 × { u8 enabled, u8 muted, u16 _, f32 gain, f32 delay }` |
| 360 | 8 | Pin config | `u8 numPinOutputs, u8 pins[5], u16 _` |
| 368 | 2112 | EQ | `[11 channels × 12 bands] × { u8 type, u8 bypass, u16 _, f32 freq, f32 Q, f32 gain }` (channel-major; `bypass` is always-zero on V2-V6, `1`=user-bypassed on V10+) |
| 2480 | 352 | Channel names | `11 × 32-byte UTF-8 NUL-terminated` |
| 2832 | 16 | I2S config (opt) | Present when packet ≥ 2848: `u8 outputSlotTypes[4], u8 bckPin, u8 mckPin, u8 mckEnabled, u8 mckMultiplierEncoded` |
| 2848 | 16 | Leveller (opt) | Present when packet ≥ 2864: `u8 enabled, u8 speed, u8 lookahead, u8 _, f32 amount, f32 maxGainDb, f32 gateDb` |
| 2864 | 16 | Per-channel preamp (V6+) | `f32 preampL, f32 preampR` |
| 2880 | 16 | Master volume (V6+) | `f32 masterVolDb` |
| 2896 | 16 | Input config (V7+) | `u8 inputSource, u8 spdifRxPin` — InputSource enum (0=USB, 1=SPDIF) |
| 2912 | 16 | LG Sound Sync (V8+) | `u8 enabled, u8 present, u8 volume, u8 muted` — only `enabled` honored on SET |
| 2928 | 16 | User volume (V9+) | `f32 userVolumeDb, u8 userMute` |
| 2944 | 16 | DAC HW mute (V10+) | `u8 enabled, u8 activeLow, u8 pin, u8 _, u16 holdMs, u16 releaseMs` |

Optional trailing sections are gated on **packet length** AND (where noted) **format version**. The 9-output crosspoint and output arrays are always present in full — the platform's actual output count comes from the header (`numOut`); RP2040's matrix view hides unused columns.

`synthesizeBulkParams(opts)` in `bulkParser.syn.ts` produces a wire-faithful packet of any allowed shape; used by `MockTransport` and parser tests.

## Status packets

### `GetStatus 0x50 wValue=9`

`numCh × u16 peaks` followed by `u8 cpu0, u8 cpu1, u16 clipFlags`. Each peak normalized as `raw / 32767`. `parseSystemStatus` always returns an 11-slot `Float32Array`; unused slots stay zero. RP2040 polls 7 channels, RP2350 polls 11.

`numCh` is platform-specific and comes from the hardware profile captured by `DspDevice.create(...)`.

**Quirk:** `parseSystemStatus` zero-fills any unread slots rather than throwing. Useful for short responses but means a totally broken response looks like a quiet device. The first-poll diagnostic logs (when `?log=1`) help disambiguate.

### `GetBufferStats 0xB0`

Fixed 44-byte packet:

| Offset | Size | Field |
|---|---|---|
| 0 | 1 | `numSpdif` (2 on RP2040, 4 on RP2350) |
| 1 | 1 | `flags` (bit 0 = PDM active, bit 1 = audio streaming) |
| 2 | 2 | `sequence` (`u16`, monotonic) |
| 4 | 32 | `4 × SpdifBufferStats` (8 B each: `free, prepared, playing, fillPct, minFillPct, maxFillPct, u16 _`) |
| 36 | 8 | `PdmBufferStats` (`dmaFill, dmaMin, dmaMax, ringFill, ringMin, ringMax, u16 _`) |

The `numSpdif` / `SpdifBufferStats` naming refers to firmware-internal SPDIF DMA consumers, not the audio-layer slot type — those are independent. A slot configured for I2S still rides the same DMA infrastructure on RP2350.

### Per-counter status reads (`GetStatus 0x50 wValue ≠ 9`)

Each `wValue` returns one `u32` or `i32`. Listed in `SystemStatusValue` enum. Wire format reference in `docs/system-status-req.md`.

| wValue (name) | Type | What |
|---|---|---|
| `ClockHz` | u32 | System clock frequency |
| `CoreVoltageMv` | u32 | Core voltage (mV) |
| `SampleRateHz` | u32 | Audio sample rate |
| `TempCDegC` | i32 | Die temperature (°C) |
| `PdmRingOverruns/Underruns` | u32 | PDM ring buffer error counters |
| `PdmDmaOverruns/Underruns` | u32 | PDM DMA error counters |
| `SpdifOverruns/Underruns` | u32 | SPDIF error counters |
| `SpdifStarvationsTotal` | u32 | Cumulative SPDIF starvation events |

## Wire-level invariants

These are properties the rest of the stack relies on; if firmware ever violates one, things will silently corrupt.

1. **Multi-byte integers are little-endian.** Both directions, all packets.
2. **Float fields are IEEE-754 single precision (4 B).** No float64 anywhere on the wire.
3. **`SetMatrixRoute` writes the full crosspoint tuple.** The firmware uses the entire `{enabled, invert, gainDb}` packet; partial writes are not supported.
4. **`SetEqParam` writes the full filter tuple.** Same as matrix route — no per-field band update.
5. **Bulk packet offsets are absolute, not relative.** V6+ trailing sections (per-channel preamp, master volume) live at fixed offsets with reserved padding between them; the parser seeks explicitly rather than relying on cursor position.
6. **Concurrent control transfers are serialized per-endpoint.** WebUSB does this implicitly. Within the app, `poll.ts` uses `inFlightStatus` / `inFlightBuffer` flags to avoid overlapping reads on `0x50` or `0xB0`.
7. **Sequence number monotonicity.** `BufferStats.sequence` increments monotonically; a gap > 1 means the app missed a poll.

## Gotchas

These are hardware/browser-environment quirks that bite during deployment.

1. **Insecure context.** Browsers hide `navigator.usb` outside HTTPS / `localhost`. Hitting the dev server from another machine over LAN HTTP fails silently as "WebUSB unavailable." Use a tunnel, `vite --host --https`, or whitelist the origin in `chrome://flags/#unsafely-treat-insecure-origin-as-secure`.

2. **Interface claim conflicts.** On Windows the vendor interface must be bound to WinUSB (Zadig). On any platform, the original .NET DSPi Console must be closed — only one process can claim the interface.

3. **Master "mute" is soft.** No firmware command for it; the client rides master volume to `-128 dB` (`MUTE_DB` in `actions.ts`) and remembers the prior value in `settings.svelte.ts`. UI policy preserved across reload via localStorage.

4. **Status zero-fill is ambiguous.** `parseSystemStatus` zero-fills unread slots. A totally broken status response looks identical to a quiet device.

5. **`'connect'` is synchronous.** `WebUsbTransport` emits the event before `requestAndOpen()` resolves. Anything depending on `attachTransportListeners` fires *during* the open call, not after.

## Firmware version history (since v1.1.3)

DSPi firmware reports two version axes:

- **`FW_VERSION_BCD`** — semantic firmware revision (e.g. `0x113` = `1.1.3`). Exposed via `GetPlatform 0x7F`.
- **`WIRE_FORMAT_VERSION`** — bulk-packet schema version, bumped only when `WireBulkParams` changes. Exposed in the bulk packet header byte 0.

The two move independently: a firmware bump can change wire behavior without bumping `WIRE_FORMAT_VERSION` (e.g. new vendor commands, deferred-execution refactors, encoding tweaks on existing fields). The version table below is the **wire/protocol** history. The console parser gates each optional bulk section on **both** `formatVersion` AND `payloadLength` (see `bulkLayout()` in `src/protocol/wireTypes.ts`); a wire-version axis isn't enough — older firmware can ship an in-development build that lies about its version.

### Bulk packet schema

| WIRE | Packet size | Sections added | Console support |
|---|---|---|---|
| **V2** | 2832 B | Baseline (header, global, crossfeed, legacy channels, delays, crosspoints, outputs, pin config, EQ, channel names) | Read-only fallback |
| **V3** | 2848 B | `WireI2SConfig` (16 B) — output slot types, BCK/MCK pins, MCK enable, MCK multiplier as **raw byte** (128, or 0 meaning 256) | Full read; writes via V6 only |
| **V4** | 2864 B | `WireLevellerConfig` (16 B) — enabled, speed, lookahead, amount, max gain, gate threshold | Full read; writes via V6 only |
| **V5** | 2864 B | Same size as V4. MCK multiplier encoding switched to `0=128×, 1=256×`. Pre-V5 firmware reads/writes the raw form. Console always assumes V5+ encoding | Read-OK for V5+ firmware; V3-V4 firmware's mck byte is misread as encoded |
| **V6** | 2896 B | `WirePreampConfig` (16 B, V6Preamp = 2880 B) — per-input-channel preamp; `WireMasterVolume` (16 B, V6Full = 2896 B) — `f32 masterVolumeDb` with `-128` mute sentinel. **Last version on v1.1.3.** | Full read/write — this is what the console writes back |
| **V7** | 2912 B | `WireInputConfig` (16 B) — `u8 inputSource` (`0=USB`, `1=SPDIF`), `u8 spdifRxPin` | Parsed into the snapshot; no UI yet |
| **V8** | 2928 B | `WireLgSoundSync` (16 B) — `u8 enabled, u8 present, u8 volume, u8 muted`. Only `enabled` is honored on bulk SET; the rest are observation-only | Parsed into the snapshot; no UI yet |
| **V9** | 2944 B | `WireUserVolume` (16 B) — `f32 userVolumeDb` (`[-60, 0]` dB), `u8 userMute`. Vendor-channel mirror of UAC1 host volume but always honored regardless of input source | Parsed into the snapshot; no UI yet |
| **V10** | 2960 B | `WireDacHwMute` (16 B) — `u8 enabled, u8 activeLow, u8 pin, u16 holdMs, u16 releaseMs`. Board-level external DAC mute pin config | Parsed into the snapshot; no UI yet |
| **V10 EQ change** | (same 2960 B) | `WireBandParams.bypass` at offset 1 (was `reserved`) — `1`=user-bypassed. Cooperates with the new `SetBandBypass 0xD8` opcode and the new `bypass` byte at offset 3 of `SetEqParam 0x42` (was `reserved`). Old console always writes `0` there, preserving "active" semantics | Console decodes `bypass` per band; no UI toggle yet |

V6 is what the console writes via `SetAllParams 0xA1`. `buildBulkParams` rejects any other version (see `src/protocol/bulkParser.ts`). V7-V10 sections ship on released 1.1.4. The console parses all of them (`bulkLayout` gates on version + length) and retains the full raw image; writes are normalized to a V6 packet, which 1.1.4 firmware merges (write path accepts formats 2-10). Note: in INDEPENDENT output-config mode the firmware skips the pin section and RX-pin hot-swap of a bulk SET entirely.

### Vendor commands added since v1.1.3 (WIRE = V3)

All bytes below are new opcodes registered after the v1.1.3 cut.

| Codes | Group | Method | FW commit |
|---|---|---|---|
| `0xB4-0xBF` (6 set + 6 get) | Volume Leveller | `setLevellerEnabled` / `…Speed` / `…Lookahead` / `…Amount` / `…MaxGain` / `…Gate` (set only; reads via bulk) | `dc6158f` — Added volume levelling |
| `0xD0 / 0xD1` | Per-input preamp | `setInputPreamp(channel, db)` / `getInputPreamp(channel)`; `wValue` = input channel index | `d576bf5` — Master volume control and per-input channel preamp |
| `0xD2 / 0xD3` | Master volume | `setMasterVolume(db)` / `getMasterVolume()` — `f32 dB`, `-128` mute sentinel, range `-127..0`, factory default `-20` | `d576bf5` (initial) → `26e5839` (default to `-20 dB`) |
| `0xD4 / 0xD5` | Master volume mode | `setMasterVolumeMode(mode)` / `getMasterVolumeMode()` — `0=independent` (stored in directory), `1=with preset` | `567ac84` — New master volume modes |
| `0xD6` | Save master volume | `saveMasterVolume()` — action-style IN; commits current live master volume into the directory's independent field; deferred to main loop | `567ac84` |
| `0xD7` | Get saved master volume | `getSavedMasterVolume()` — reads the directory's independent field (mode-0 boot source) without touching live state | `567ac84` |

### Behavior changes on existing commands

These opcodes pre-date v1.1.3 but behave differently on current firmware. Anything that affects the host contract is highlighted.

| Code | Group | Change | Console impact |
|---|---|---|---|
| `0x44` | `SetPreamp` (legacy) | Now broadcasts to **all** input channels (was single global preamp). Per-channel control moved to `0xD0`. | Console uses `0xD0`; legacy path still works for single-value writes |
| `0x45` | `GetPreamp` (legacy) | Returns channel 0's preamp (was the single global value). | Same |
| `0x51` | `SaveParams` | **Deferred to main loop.** Always returns `FLASH_OK` immediately; the actual flash write happens asynchronously. The host can no longer detect a save failure synchronously. | Console treats the response as "accepted," not "committed." |
| `0x53` | `FactoryReset` | **Deferred to main loop**, brackets reset with pipeline mute / Core-1 sync / delay-line zero. Always returns `FLASH_OK`. | Same — fire-and-forget. |
| `0x92` | `PresetDelete` | Switched from single-slot pending flag to a 16-bit pending mask — multiple deletes queue back-to-back without dropping. | No host change. |
| `0x95` | `PresetGetDir` | Response grew from **6 → 7 bytes**; byte 5 is `output_config_mode` (was `include_pins`; values 1:1: 0=independent, 1=with-preset), byte 6 is `master_volume_mode` (0=independent, 1=with-preset). Older firmware truncates to 6 bytes. | Console always requests 7 B; `decodePadded` zero-extends legacy 6-B responses (treating mv mode as `independent`, the correct legacy semantic). |
| `0xC0` | `SetOutputType` | Switched from single pending slot to a per-slot pending bitmask. Tear-down/setup of pools is gated by `output_type_switch_in_progress`; buffer-stats reads return safe zeroes during the window. | No host change. |
| `0xC8` | `SetMckMultiplier` | `wValue` encoding **changed**: was raw `128` or `256`; now `0=128×`, `1=256×`. Also rejects `256×` at sample rates ≥ 96 kHz (`PIN_CONFIG_INVALID_PIN`) and auto-clamps to `128×` on rate changes. | Console sends `0`/`1` already. Connecting the current console to V3/V4 firmware would mis-set the multiplier. |
| `0xC9` | `GetMckMultiplier` | Returns the encoded byte (`0`/`1`) instead of the raw `128`/`256`. Also runs the 96 kHz clamp before answering. | Console reads the encoded form. |

### Hardware / DSP changes worth flagging

These don't change the wire protocol but affect what hosts observe across a v1.1.3 → current upgrade.

- **Master volume soft-start.** v1.1.3 used a Taylor-series dB→linear approximation that could produce deafening output transients during boot before the saved master volume applied. Replaced with `powf` (`8c7759f`). Boot-time audio loud spikes should be gone.
- **RP2040 max delay reduced.** `MAX_DELAY_SAMPLES` was unified at `4096` (85 ms at 48 kHz) on both platforms; now RP2040 caps at `2048` (42 ms). The `delay_ms` field per output is still wired through, but on RP2040 the firmware silently clamps to the new ceiling.
- **Include-pins became output-config mode.** The 0x98/0x99 bool was broadened to a persistence mode for the whole physical-IO block (pins + types + BCK/MCK + SPDIF RX pin). Default is `1` (WITH_PRESET — presets restore IO); factory reset resets to it. In `0` (INDEPENDENT) preset load / factory reset / bulk SET never touch live IO; persistence is via `SaveOutputConfig 0x52`.
- **Flash clock divider** lowered (`fc4998b`, `2e655b6`) and **flash write pipeline reset** added (`25be9fb`) — should reduce save/load glitches but doesn't change the wire surface.
- **I2S output fixes** since v1.1.3: channel L/R packing (`a5953fc`), output selection (`601a841`), 96 kHz / 24-bit playback (`11e6b45`, `003a694`), I2S clock rounding (`01bcb65`), MCK multiplier set path (`31506d2`, `7cc937a`, `43cb7ce`), and preset-save popping (`f4a732e`).

---

## v1.1.4 — released (`main`)

Firmware `1.1.4`, `WIRE_FORMAT_VERSION = 10` (`firmware/DSPi/config.h`, `bulk_params.h`). The console wires the full device/protocol surface below; user-visible features are still pending (see docs/V114-FINAL.md migration list).

### New vendor commands

All four sections below are gated behind their respective bulk-packet versions but each also gets a per-field vendor opcode for round-trip control.

| Codes | Group | Notes | FW commit |
|---|---|---|---|
| `0x52` | `SaveOutputConfig` | Action-IN, no payload, 1-byte `PresetResult`; flash write deferred to main loop. Persists live pins/types/BCK/MCK/SPDIF-RX-pin to the directory's device-global block. Accepted in both output-config modes (dormant in WITH_PRESET). Repurposes the removed `LoadParams` | output-config persistence series |
| `0xD8 / 0xD9` | Per-band EQ bypass | `wValue = (channel<<8) \| band`, 1-byte body. The same byte is exposed at offset 1 of every `WireBandParams` (was `reserved`) and at offset 3 of the `SetEqParam 0x42` payload. Old SetEqParam writes (offset 3 = `0`) still mean "active" | `a5f7b18` — Per-band bypass toggle |
| `0xDA / 0xDB` | User volume | `f32 dB`, clamped to `[-CENTER_VOLUME_INDEX=60, 0]`. Same quantity as UAC1 host slider but vendor-channel write path bypasses input-source gating | `0b1d415` — Added command to set user volume |
| `0xDC / 0xDD` | User mute | `u8 0/1`. Distinct from UAC1 `audio_state.mute` — the audio path OR's them, but UAC1 mute is USB-gated while user_mute is always honored | (same series as user volume) |
| `0xE0 / 0xE1` | Input source | `u8 InputSource` enum: `0=USB`, `1=SPDIF`. Drives a full pipeline reset when switched | `9b153d9` and predecessors — Fix EMC blocking release wait |
| `0xE2` | `GetSpdifRxStatus` | 16-byte `SpdifRxStatusPacket`: `u8 state` (`Inactive=0`, `Acquiring=1`, `Locked=2`, `Relocking=3`), `u8 inputSource, u8 lockCount, u8 lossCount, u32 sampleRate, u32 parityErrors, u16 fifoFillPct, u16 _` | SPDIF input series |
| `0xE3` | `GetSpdifRxChStatus` | 24-byte raw IEC 60958 channel-status block (cumulative bits across subframes; layout per the standard) | SPDIF input series |
| `0xE4 / 0xE5` | SPDIF RX pin | Action-style IN; `wValue` = GPIO. Saves to RAM; persisted via `PresetSave` (WITH_PRESET mode) or `SaveOutputConfig 0x52` (INDEPENDENT mode) | `4e3a129` — SPDIF IN pin assignment follows output pin conventions |
| `0xE6 / 0xE7` | LG Sound Sync enable | Per-preset toggle | `1722c0c` — Added LG Sound Sync compatibility |
| `0xE8` | `GetLgSoundSyncStatus` | 16-byte `LgSoundSyncStatus`: `u8 enabled, u8 present, u8 volume (0..100 or 0xFF=never decoded), u8 muted` — read-only observation of LG TV signaling | LG series |
| `0xEA / 0xEB` | DAC HW mute config | 16-byte `DacHwMuteConfig`: `u8 enabled, u8 activeLow, u8 pin, u16 holdMs, u16 releaseMs` — board-level external DAC MUTE pin | `7186eb7` — Added DAC hardware mute function |
| `0xEC` | `TestDacHwMute` | No payload; pulses the configured mute pin ~1 s. Useful for verifying wiring | DAC HW mute series |

### New EQ filter types

`FilterType` extended with two entries — old `0..5` values unchanged:

| Value | Name | Commit |
|---|---|---|
| `6` | `FILTER_NOTCH` | `e5af871` — Add notch filter (PR #39) |
| `7` | `FILTER_ALLPASS` | `d433762` — Add 2nd order allpass filter (PR #52) |

### Device→host notification subsystem (new)

A new push channel rides the existing `VENDOR_EP_IN = 0x83` interrupt endpoint (previously described as "dummy for macOS compatibility" — it is now load-bearing). See `firmware/DSPi/notify.h` and `Documentation/Features/notification_protocol_v2_spec.md`.

Two protocol versions coexist:

- **v1** (legacy): single 8-byte master-volume packet `[0x01, 0, 0, 0, f32 db_LE]`. Always emitted alongside v2 for backward compatibility.
- **v2** generic: packet header `[ver=0x02, evt, flags, seq, ...]`. Events:
  - `0x00` `IDLE` — keep-alive
  - `0x01` `MASTER_VOLUME` — v1-compatible single-field packet (above)
  - `0x02` `PARAM_CHANGED` — `[ver, evt, flags, seq, u16 wireOffset_LE, u16 size_LE, u8 src, u8[3] _, ...value]`. **The host dispatches purely on `offsetof(WireBulkParams, field)`** — adding a parameter doesn't require a wire-format change
  - `0x03` `BULK_INVALIDATED` — host should re-issue `GetAllParams 0xA0`
  - `0x04` `PRESET_LOADED` — `[..., seq, u8 slot]`; always followed by `BULK_INVALIDATED`

The `src` byte on `PARAM_CHANGED` distinguishes where the write came from: `UNKNOWN=0, HOST_SET=1, BULK_SET=2, PRESET=3, FACTORY=4, GPIO=5, INTERNAL=6, UAC1=7`. `UAC1` notably lets the console tell its own outbound host-volume writes apart from OS slider changes (commit `09b0486`).

Console-side wiring is shipped: `notifyChannel` reads the endpoint, `wireMirror` splices `PARAM_CHANGED` values into the retained raw bulk image, and `notifyApply` applies the re-decoded change set — see `HW-NOTIFICATIONS.md`.

### Behavior changes on existing commands (1.1.4)

| Code | Group | Change |
|---|---|---|
| `0x42` `SetEqParam` | EQ band write | Payload byte at offset 3 changed from `reserved` to `bypass`. The codec still accepts old `0` writes (= active); to enable per-band bypass via this opcode the byte must be `1` |
| `0x91` `PresetLoad` | Preset load | In master-volume `INDEPENDENT` mode, preset load **no longer overrides** live master volume (commit `2a76494`). Was changing master volume on load even in independent mode |
| UAC1 Feature Unit | Host volume | Volume changes initiated by the host's audio stack now notify with `PARAM_SRC_UAC1` so the console can distinguish them from its own writes (`09b0486`) |
| Various | Bypass state | Factory defaults / existing preset load now correctly apply bypass state (`bb5a8bc`) |

### Hardware changes worth flagging

These don't change the wire surface but are visible behavior changes:

- **SPDIF input.** RP2040/RP2350 can now receive SPDIF as an audio source. Default RX pin is GPIO 5 (`e47d2b8`). When SPDIF is selected, USB host volume control is inhibited and ring-buffer drain emits nominal-rate feedback (`6e79934`). RP2040 input level fix (`9cf5ca3`).
- **Master clock GPOUT.** Jitter-free 128×/256× MCK at 48 kHz, 128× at 96 kHz via the GPOUT path (`bd24060`). Pin remains configurable via `SetMckPin 0xC6`.
- **External DAC hardware mute.** New pipeline that holds the DAC mute pin during sample-rate switches, defeating common DACs' auto-mute on clock change. Defaults to GPIO 11 active-low (`cbd1d24`).
- **LG Sound Sync.** Decodes the LG TV's "Sound Sync" volume/mute side-channel out of the SPDIF channel status and ties it to the user volume axis when enabled (`1722c0c`, `43816cc`).
- **Click-free master/host volume.** Volume changes now ramp instead of step (`a03928f`).
- **32-bit I2S DAC auto-mute defeat** (`5f8ab5e`).
- **EMC fixes** for input-source / output-type switching (`725f2f5`, `e298931`, `9b153d9`).
- **Loudness compensation math fix** (`9df40f2`); default reference SPL adjusted (`2c30e68`).
- **Refactor.** Vendor command dispatch extracted from `usb_audio.c` to `vendor_commands.c` (~2000 lines); pipeline reset refactored to reduce IRQ blackout (`32abc29`); USB descriptors (WCID + IAD + MS OS 2.0) cleaned up (`86ab2c4`); USB poking tool added (`e7f46eb`). No host-visible wire impact.

### Console-side gaps summary

Everything in this section is unwired. Lowest-friction wins (no new UI surface) would be:

1. **EQ band bypass** — already a logical extension of the existing EQ panel; cheap to add the `0xD8` write + bulk decode of the new byte.
2. **User volume / mute** — drop-in replacement for the existing soft-mute hack (`MUTE_DB` in `actions.ts`); replaces `-128 dB` master-volume riding.
3. **Input source toggle + SPDIF RX status** — net-new UI but small surface (one dropdown + a status badge).
4. **Notification subsystem** — biggest payoff (eliminates polling) but also biggest implementation cost; requires claiming the interrupt-IN endpoint and writing a `wireOffset → store-patch` dispatcher.
