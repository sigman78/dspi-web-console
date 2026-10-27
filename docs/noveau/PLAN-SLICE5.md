# Slice 5 — owner feedback round 2 (2026-10-27)

Owner review of `exp/noveau` at 735d30d, turned into one polish wave plus the
"clean cut" branch. Everything here keeps runtime / protocol / state untouched
except pure helpers; capability gating stays; every wave passes
`npm run check`, `npm run test`, `npm run test:layout`.

## 0. Dev-server startup: diagnosis only

Measured on the owner's machine (headless Edge, `?mock&ui=noveau`):

| case | server ready | first page load | requests |
| --- | --- | --- | --- |
| warm dep cache | 1.2 s | 2.9 s cold HTTP cache, 1.2 s warm | 399 (237 svelte js+css, 22 deps, 6 fonts) |
| `--force` dep re-bundle | 1.2 s | 2.8 s | same |

`vite:transform` is called 391 times per load and the queue depth reaches
~750 ms per file: App.svelte imports **both** UI trees (classic TopBar,
ChannelRail, ConnectedApp with all seven tabs, and the noveau shell with all
destinations), so every component in `src/components` is compiled on the first
request. Not a defect in the noveau UI; it is unbundled dev serving over
HTTP/1.1. The production build is one bundle. Pruning the legacy tree (§6)
removes roughly a third of the modules. If the owner sees tens of seconds
rather than ~3 s, the usual suspects are DevTools "disable cache" or AV
scanning `node_modules` — not the app.

## 1. Channel rail head (builder A1)

- **Scene slots 2 × 5** instead of 1 × 10: each ≥ 32 × 22 px, digit 12 px
  mono, startup ring + unsaved underline unchanged. Rows gap 2 px.
- **Bypass becomes an icon button** (same wave glyph the classic TopBar
  uses, `icon-toggle` with `.on` = err tint), sitting in the volume row next
  to mute, so mute and bypass read as a pair. The BYPASS text row goes away.
- **Icon normalisation**: every rail-head icon button is 22 × 22 px with a
  14 px glyph (mute today: 12 px glyph; save/revert today: 20 px button).
  One shared `.rail-ib` size rule, no per-component overrides.
- The preset name field stays the editor trigger; swap the chevron for a
  "sliders" glyph so it reads as *edit*, not *select*.

## 2. PRESETS flyout → preset editor for the active slot (builder A2)

Owner: the flyout's slot list duplicates the rail digits; what is missing is
a real editor. New flyout, same anchor (`data-presets-toggle`, 400 px):

```
PRESET 3                                   ×
NAME      [ Living room            ]        (inline input, rename on Enter/blur)
STARTUP   (•) last used  ( ) this preset    (segmented; "preset 5" hint when another slot is startup)
          [SAVE] [REVERT] [COPY] [PASTE] [EXPORT JSON] [IMPORT JSON]
          — quiet chips, only the applicable ones; SAVE accent
OPTIONS   Master volume stored with preset   [toggle]
          Output config stored with preset   [toggle]
          Warn when switching with unsaved   [toggle]
MANAGE    Delete slot  [ 4 Studio ▾ ] [DELETE]   (other occupied slots only, ConfirmButton)
```

- EXPORT = copy active to the clipboard if not already held for this slot,
  then download (reuse `exportHeldPreset`; factor a pure
  `presetExportFile(name, slot, blob, caps)` if cleaner).
- IMPORT = file picker → `decodeImportedPreset` → `pastePresetTo` into the
  active slot. Note: `pastePresetTo` restores *and saves* the slot, so an
  import replaces the slot's flash immediately and then renames it to the
  imported name; the chip title says so.
- EXPORT captures the live active state through a pure `presetExportFile`
  and never touches the copy clipboard.
- "Boot into last active preset" moves here as the STARTUP segmented
  control; the three remaining device-wide toggles move here from SETUP ›
  Device (new `presets/PresetOptionsRows.svelte`; A4 removes the SETUP copy).
- `slotRows.ts` / `rowActions.ts` and their tests go away or shrink to what
  the editor needs. Tests only for non-obvious logic (which chips apply).

## 3. PROGRAM (builder A3)

Firmware order (DSPi `current_architecture.md`, feature specs):

```
Preamp → Input EQ → Leveller → Upmix ⟶ MATRIX ⟶ Crossfeed (per output pair, PASS 4.5)
  → Subharm → Psybass → Output xover/EQ → Trim/Mute → Loudness → Delay → Limiter → Master volume
```

- `chainBlocks` emits that order; Loudness, which runs inside the output
  stage after trim, sits as the last module before the OUTPUTS anchor. Loudness / Crossfeed / Psybass / Subharm
  `pass` captions become "per output · after matrix"; Leveller / Upmix
  "inputs · before matrix".
- **Matrix and Output stage stop being modules.** They stay in the strip as
  non-selectable *anchors*: MATRIX (route count, divider styling as today)
  and OUTPUTS (`7 on · 2 muted · lim 3`, with a » that jumps to TUNE for the
  selected output). `MatrixModule.svelte`, `OutputStageModule.svelte` and
  the two keys leave `ProgramModuleKey`.
- **Blurb per module**: `ModuleFrame` gains `blurb: string`, one or two
  sentences at 11 px `--text-dim` under the header. Text:
  - Preamp — "Per-input gain ahead of everything else. Trim hot sources or
    balance channels before EQ sees them."
  - Input EQ — "Up to 10 parametric bands per input, applied before routing.
    Edit bands in TUNE with an input selected."
  - Leveller — "Upward RMS compressor: lifts quiet passages toward a target
    without touching loud ones. Speed sets how fast gain follows the music."
  - Crossfeed — "Headphone crossfeed (BS2B): bleeds a filtered, delayed part
    of each channel into the other to soften hard stereo. Per output pair."
  - Loudness — "Equal-loudness compensation (ISO 226): boosts bass and
    treble as the volume goes down. The graph is the correction at the
    current volume relative to the reference level."
  - Psybass — "Synthesises harmonics of bass the speaker cannot reproduce,
    so the ear infers the fundamental. Runs before the output crossover."
  - Subharm — "Octave divider: generates sub-bass one octave below the
    selected bands. Runs per output, before the crossover and Psybass."
  - Upmix — "Derives centre and surround feeds from a stereo input and
    offers them as extra matrix sources. Parks on multichannel input or
    above 48 kHz."
- Default selected module stays `crossfeed`; `noveauUi.programModule`
  falls back to the first selectable block when the stored key is absent.

## 4. SETUP (builder A4)

- **DEVICE page** = DevicePanel · TelemetryPanel · ErrorCounters +
  BufferStats. The DIAGNOSTICS page goes away (identity + health in one
  place). DevicePanel's DEBUG toggle stays as is.
- **I/O page** gains LgSoundSyncPanel and DacHwMutePanel. Measured at the
  floor in `?mock=multi`, column 1 overflowed (809 px), so the page was
  rebalanced: col 1 Input config · Outputs (640), col 2 System clock · I2S
  clock · DAC HW mute (669), col 3 LG Sound Sync · ADAT in · ADAT out · Pin
  map (678). Body budget 698.
- PresetOptionsPanel leaves SETUP (A2 owns the replacement); delete
  `setup/PresetOptionsPanel.svelte`.
- `setupPages.ts` / test updated.

## 5. DEVICE → ABOUT destination (builder A5)

Rail: TUNE · PROGRAM · SETUP · ABOUT (bottom, pushed; "i" in a circle).
`AboutView` reuses the SETUP page grid (three 320-ish columns, no selector):

- CONSOLE — version · git sha · build date · UI variant · mock profile when
  active · WebUSB support line; links as quiet chips: GitHub repo, report an
  issue (`reportIssueUrl` with fw/serial context), firmware repo
  (`https://github.com/WeebLabs/DSPi`), production site is **not**
  hardcoded (see memory).
- LATEST CHANGES — `LATEST_CHANGES.highlights`, restyled, no Panel chrome.
- DEVICE — firmware label, platform, build stamp, wire format, CS proto,
  serial (read-only KV; DevicePanel in SETUP keeps the actions).

## 6. Clean cut: branch `v2`

After the polish commit on `exp/noveau`:

1. `git switch -c v2` from it. `uiVariant()` default becomes `noveau`;
   `?ui=classic` keeps the old shell for one release line.
2. Prune wave: a dependency audit lists every module reachable only from the
   classic entry (TopBar, ChannelRail, ConnectedApp, `tabs/*`,
   PendingChangesBar, tab shortcuts…). Delete them with their tests, keep
   everything the noveau tree imports (system panels, chrome controls, bode,
   eq, presets helpers). Gate: check / lint / test / build / test:layout.
3. Follow-ups after the cut: pair-link toggle once #138 lands, CI wiring of
   `test:layout`, A/B audition verb.

## Shared-file rules for the wave

- `test/layout/noScroll.spec.ts` and the commit are the orchestrator's;
  builders do not edit the spec.
- Ownership: A1 `SceneRow/RailHead/VolumeBlock/PresetIcon`; A2 `presets/*`;
  A3 `program/*` + `noveauUi.programModule`; A4 `setup/*`; A5 `IconRail`,
  `NoveauShell`, `noveauUi.destination`, new `about/*`.
- Builders run concurrently in one tree: judge `npm run check` / `vitest`
  output by file ownership; your own files must be clean.
