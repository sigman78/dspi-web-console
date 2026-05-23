# DSPi USB Interface

All communication is **vendor-class control transfers** on a claimed interface. No interrupt or bulk endpoints; no streaming.

### Identity

- **VID / PID**: `0x2E8A / 0xFEAA` (RP-vendor + DSPi product)
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

The Leveller block in the bulk packet is V7+ optional — `null` on older firmware. The other two groups are present from V2.

### Persistence and presets

`DspDevice` exposes the full preset wire surface plus the legacy persistence trio. State-runtime/UI integration is the next layer; see `HW-TODO.md §3` and `HW-PROFILES.md §6`.

| Codes | Group | Method | Returns |
|---|---|---|---|
| `0x51 / 0x52 / 0x53` | `SaveParams` / `LoadParams` / `FactoryReset` | `saveParams` / `loadParams` / `factoryReset` | `Result<void, FlashResult>` |
| `0x83` | `ClearClips` | `clearClips` | `void` |
| `0xB1` | `ResetBufferStats` | `resetBufferStats` | `boolean` |
| `0x9B / 0x9C` | `SetChannelName` / `GetChannelName` | `setChannelName` / `getChannelName` | UTF-8 string |
| `0x90 / 0x91 / 0x92` | `PresetSave` / `PresetLoad` / `PresetDelete` | `savePreset` / `loadPreset` / `deletePreset` | `Result<void, PresetResult>` |
| `0x93 / 0x94` | `PresetGetName` / `PresetSetName` | `getPresetName` / `setPresetName` | UTF-8 string |
| `0x95` | `PresetGetDir` | `getPresetDirectory` | `PresetDirectoryInfo` |
| `0x96 / 0x97` | `PresetSetStartup` / `PresetGetStartup` | `setPresetStartup` / `getPresetStartup` | `{mode, slot}` |
| `0x98 / 0x99` | `PresetSetIncludePins` / `PresetGetIncludePins` | `setPresetIncludePins` / `getPresetIncludePins` | `boolean` |
| `0x9A` | `PresetGetActive` | `getActivePreset` | `u8` (0xFF transient — coerce to 0) |
| `0xD4 / 0xD5` | Master volume mode | `setMasterVolumeMode` / `getMasterVolumeMode` | `MasterVolumeMode` |
| `0xD6 / 0xD7` | Save/get saved master volume | `saveMasterVolume` / `getSavedMasterVolume` | `boolean` / `f32` |
| `0x46 / 0x47` | Bypass | `setBypass` / `getBypass` | `boolean` |

### Not yet wired

Firmware-defined commands with no `DspDevice` method yet. See `HW-TODO.md §1` for the backlog.

| Codes | Group | Notes |
|---|---|---|
| `0x48 / 0x49` | Per-channel delay | Bulk-only `dsp.delaysMs[]` |
| `0x54 / 0x55` | Channel gain | Distinct from output gain |
| `0x56 / 0x57` | Channel mute | Distinct from output mute |
| `0x7C / 0x7D` | Output pin | Bulk-only `dsp.pins[]` |
| `0xC0 / 0xC1` | Output slot type | SPDIF↔I2S; returns `PinConfigResult` |
| `0xC2 / 0xC3` | I2S BCK pin | Bulk-only |
| `0xC4 / 0xC5` | MCK enable | Bulk-only |
| `0xC6 / 0xC7` | MCK pin | Bulk-only |
| `0xC8 / 0xC9` | MCK multiplier | Bulk-only |
| `0xF0` | `EnterBootloader` | Jumps to ROM bootloader |

Preset surface and persistence command reference: see `docs/HW-PROFILES.md`.

## Bulk packet layout — `GetAllParams 0xA0`

The largest packet on the wire and the structure most likely to drift between firmware revisions. Layout mirrors `DSPiConsole.Usb/BulkParamsParser.cs`. **Min size 2832 B; max request size 2896 B.**

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
| 368 | 2112 | EQ | `[11 channels × 12 bands] × { u8 type, u24 _, f32 freq, f32 Q, f32 gain }` (channel-major) |
| 2480 | 352 | Channel names | `11 × 32-byte UTF-8 NUL-terminated` |
| 2832 | 16 | I2S config (opt) | Present when packet ≥ 2848: `u8 outputSlotTypes[4], u8 bckPin, u8 mckPin, u8 mckEnabled, u8 mckMultiplierEncoded` |
| 2848 | 16 | Leveller (opt) | Present when packet ≥ 2864: `u8 enabled, u8 speed, u8 lookahead, u8 _, f32 amount, f32 maxGainDb, f32 gateDb` |
| 2864 | 16 | Per-channel preamp (V6+) | `f32 preampL, f32 preampR` |
| 2880 | 16 | Master volume (V6+) | `f32 masterVolDb` |

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
