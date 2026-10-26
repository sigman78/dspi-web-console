# Noveau slice 1 — shell + TUNE behind `?ui=noveau`

Implements README §6.7 (shell) and §6.2 TUNE for the selected channel, in
mock mode, with the no-scroll check. Branch `exp/noveau` (from master; the
EQ pair-link feature of `feat/eq-channel-link` is NOT on this branch, so the
"Link with pair" toggle is deferred until #138 lands).

Hard rules for every file in this slice:

- Runtime, protocol, transport, domain models, state model: untouched except
  where listed. Components read `s.mirror.current` and call runtime verbs.
- Capability gating stays: a control appears only if the device has it.
- Classic UI (`?ui` absent) must render pixel-identical. All new code lives
  under `src/components/noveau/` plus the small hooks listed below.
- Density: rows 24 px, section headers 28 px, labels 11 px sans min, values
  12 px mono (11 inside dense tables), nothing at 9 px except icon captions.
- No new scroll regions. `body.noveau-mode { overflow: hidden }` and every
  area has a fixed or elastic budget (README §6.2).
- Conventions: Svelte 5 runes, `@/` aliases, `import * as` for barrels,
  no `await import`, no comments that narrate history, `_`-prefix unused.
- Tests only for non-obvious behaviour (pure math, guard logic). No tests
  that re-assert constants or log output.

## Facts the builders need

- Session access inside the shell: `getSession()` from
  `@/components/sessionContext` (context set once by the shell, like
  `ConnectedApp`). Outside it: `activeSession()` from `@/state`.
- Selected channel: `settings.selectedChannel`, `selectChannel(id)` (state).
- EQ verbs (`@/runtime`): `setEqFilter(s, chId, band, FilterParams)`,
  `setBandBypass(s, chId, band, bool)`, `setXoverBand(s, chId, band, FilterParams)`,
  `setXoverBypass`, `copyEqBands(s, from, to)`, `setInputPreamp(s, inputSlot, db)`.
  All EQ band writes are click-paced `write()` — never call them per
  pointermove; drag keeps a local draft and commits once on release.
- Output stage verbs: `setOutputGain(s, wireIndex, db)`, `setOutputDelay`,
  `setOutputMuted`, `setOutputEnabled`. Limits in `Mix.*` (`@/domain`):
  OUTPUT_GAIN -60..+12 step 0.1, OUTPUT_DELAY 0..170 step 0.1.
- Crosspoints: `setCrosspointEnabled(s, inputSlot, outputSlot, bool)`,
  `setCrosspointGain(s, in, out, db)` (scrub lane), `setCrosspointInvert`.
  Rows: `matrixRows(snap, s.telemetry.activeInputChannels)` → `MatrixRow[]`
  with `cells: RouteModel[]` (`enabled`, `invert`, `gainDb`, `outputWireIndex`).
  Phase invert is a crosspoint property, not an output property.
- Limiter (gated `features.limiter`): `snap.limiter[wireIndex]`
  (`enabled`, `thresholdDb`, `releaseMs`, `linkGroup`); verbs
  `setLimiterEnabled(s, out, bool)`, `setLimiterThreshold` (scrub),
  `setLimiterRelease` (scrub), `setLimiterLinkGroup`. Live GR:
  `s.telemetry.limiterMeterDb?.[wireIndex]`, and the view must hold
  `const release = s.telemetry.wantLimiterMeter()` while mounted and call
  `release()` on unmount (see `LimiterPanel.svelte`).
- Processor membership: output-side masks are bit `wireIndex` of
  `snap.loudness.outputMask`, `snap.psybass.outputMask` (gate
  `features.psybass`), `snap.subharm.outputMask` (gate `features.subharm`);
  toggles `toggleLoudnessOutputChannel(s, wireIndex)`,
  `togglePsybassOutputChannel`, `toggleSubharmOutputChannel`. The leveller
  masks are INPUT-side: bit `inputSlot` of `snap.leveller.detectorMask` /
  `applyMask`, toggles `toggleLevellerDetectorChannel(s, slot)` /
  `toggleLevellerApplyChannel`. So an output row shows LOUD · PSY · SUB; an
  input row shows LEV DET · LEV APPLY.
- Volume: see `MasterVolumeMini.svelte` + `masterVolumeTaper.ts`
  (`setUserVolume`, `setMasterVolume`, `toggleMute`, `settings.volumeAxis`,
  `setVolumeAxis`). Bypass: `setBypass(s, bool)`, `snap.bypass`.
- Presets: `s.presets.active`, `s.presets.names[i]`, `presetsDirty(s)`,
  `loadPresetSlot(s, slot)` (already runs the dirty boundary modal),
  `saveActivePreset(s)`, `revertActivePreset(s)`, startup slot from
  `s.presets` (see `PresetTile.svelte` for the star), `PRESET_SLOT_COUNT`.
- Staging dock: `s.staging.entries`, `.applying`, `.applyAll()`,
  `.discardAll()`, `s.writes.busy` (see `PendingChangesBar.svelte`).
- Telemetry for health: `s.telemetry.cpu0/cpu1`, `.info.sampleRateHz`,
  `.clockHz`, `.coreVoltageMv`, `.tempCDegC`, `s.health.degraded`,
  `connection.phase/connected`, `s.telemetry.clipLatched[chId]`,
  `clearClips(s)`.
- Device chip: reuse `DeviceSwitcher.svelte` as is.
- Channel list: extract the body of `ChannelRail.svelte` (sections + rename
  logic + `ChannelRow`) into `ChannelList.svelte` with a prop
  `disabledOutputs: 'hide' | 'stub'`; classic rail passes `'hide'` and keeps
  its head, so it renders exactly as before.
- Curves: `filterCurve(filters, preampDb, xoverBands)` and
  `filterCurveAt(...)` in `@/components/bode/filterCurve`; `BODE_FREQS` /
  `fForXNorm` in `bodeFreqs.ts`; `Eq.FREQ_MIN_HZ/MAX_HZ`, `Eq.BODE_DB_RANGE`.
- Band type choices: `offeredTypes(features)` from `BandTypeSelect.svelte`;
  `seedTypeChange(current, type)` and `defaultFilter()` from `@/domain`.
- AutoEQ: `AutoEqBrowser.svelte` props `{ channel, preampDb, onClose }`.
- Copy mode: `eqUi.copySource`, `setEqCopySource`, `clearEqCopySource`.

## Files

### Hooks into existing code (small, classic-safe)

- `src/devOptions.ts`: `export function uiVariant(): 'classic' | 'noveau'`
  reading `?ui=noveau`; document in the header comment.
- `src/App.svelte`: when `uiVariant() === 'noveau'` and the app is `ready`,
  render `<NoveauShell session=...>` (keyed on session) instead of
  TopBar + ChannelRail + ConnectedApp; hero / splash paths unchanged
  (TopBar still shown above the hero in both variants). Add/remove
  `document.body.classList` `noveau-mode` in an effect.
- `src/app.css`: `body.noveau-mode { overflow: hidden; min-width: 1440px;
  min-height: 790px; }`.
- `src/components/chrome/ChannelRail.svelte` → uses new `ChannelList.svelte`.
- `src/components/bode/BodePlot.svelte`: optional interactive node layer
  (below). No behaviour change when the new props are absent.

### New: `src/components/noveau/`

- `noveauUi.svelte.ts` — `$state` store: `destination: 'tune' | 'program' |
  'setup' | 'library' | 'device'` (only `tune` is implemented; others render
  a one-line "not in this slice" placeholder), `selectedBand: number | null`,
  `healthOpen: boolean`.
- `NoveauShell.svelte` — sets `SESSION_KEY` context; CSS grid columns
  `56px 200px 1fr`, rows `1fr 28px`; status line spans all columns. Runs the
  same `reconcileSelectedChannel` effect as `ConnectedApp`.
- `IconRail.svelte` — five entries, inline SVG glyphs, 9 px mono caption.
- `RailHead.svelte` — DeviceSwitcher; `SceneRow.svelte` (10 slots, active
  highlighted, amber dirty dot, startup star, faint dashed empties, click →
  `loadPresetSlot`; when dirty show `Save` (accent) / `Revert` (outline));
  `VolumeBlock.svelte` (User | Master segmented, range, mono readout, MUTE);
  bypass row with `ToggleSwitch`.
- `RailFoot.svelte` — health dot (ok / warn / err from
  `chromeConnectionStatus` logic in `connectionStatus.ts`) + label; click
  opens a popover anchored above with CPU0/CPU1/rate/clock/V/T° and a
  CLEAR CLIPS chip when any clip is latched.
- `StatusLine.svelte` — left: fw label · wire label · rate · link state
  (dim mono 11 px); right: `nothing staged` or `N changes · APPLY ·
  DISCARD` wired to `s.staging`.
- `tune/TuneView.svelte` — grid columns `1fr 300px`, rows `1fr 72px 32px`
  in the left column; inspector spans rows on the right. Selected channel
  from `settings.selectedChannel`; if null → auto-select the first visible
  channel (one effect, same rule as classic).
- `tune/EqGraph.svelte` — wraps `BodePlot` with the interactive node layer;
  owns the drag draft (local `FilterParams[]` while dragging, curve computed
  from the draft), commits on release; wheel over a node changes Q (coalesce
  commits with a 150 ms trailing debounce); double-click on empty plot
  converts the first Flat band to Peak at (f, db), Q 1.0; right-click opens
  `BandMenu.svelte` (type list from `offeredTypes` + Bypass) positioned at
  the pointer; xover bands drawn as diamonds, frequency-only drag →
  `setXoverBand`. Shows the value callout for the selected band and the
  cursor readout.
- `tune/OutputStage.svelte` (72 px, two 32 px lines) — line 1: TRIM
  (ValueField), DELAY (ValueField), MUTE (ToggleSwitch), ENABLED
  (ToggleSwitch), TYPE read-only text; line 2 (gated `features.limiter`):
  LIMITER toggle, THRESH, RELEASE, LINK group (SegmentedSelect 0..max), GR
  bar; right-aligned membership chips LOUD · PSY · SUB (`chip` + `on`).
- `tune/InputStage.svelte` (same slot for inputs) — PREAMP `LabeledSlider`
  + reset; membership LEV DET · LEV APPLY.
- `tune/Toolbar.svelte` (32 px) — `+ Add band`, `AutoEQ…`, `Copy` /
  `Paste` / `Exit` (copy mode as in `BandsPanel`), `Reset`.
- `tune/Inspector.svelte` — three sections with 28 px headers:
  `BandSection.svelte` (TYPE via `BandTypeSelect`, FREQ / GAIN / Q
  `ValueField`s with a thin range each, BYPASS toggle; 120 px body),
  `BandsTable.svelte` (10 × `BandRow` from `@/components/eq`, the row
  selected in the graph highlighted, click a row to select), and
  `SourcesSection.svelte` (outputs: one row per live input: name with hue
  dot · enable toggle · gain ValueField · ⌽ invert chip; inputs: the
  transposed list, one row per enabled output, same verbs).

### `BodePlot` interactive layer (additive)

New optional props:

```ts
nodes?: BodeNode[];              // { id, f, db, label, channelId?, shape: 'circle' | 'diamond', selected?, bypassed?, lockDb? }
onNodeSelect?: (id: string) => void;
onNodeDrag?: (id: string, f: number, db: number) => void;      // every pointermove while dragging
onNodeDragEnd?: (id: string, f: number, db: number) => void;   // once, on release
onNodeWheel?: (id: string, deltaY: number) => void;
onNodeContext?: (id: string, clientX: number, clientY: number) => void;
onPlotDblClick?: (f: number, db: number) => void;
```

Pointer capture on the node; `lockDb` nodes move in f only. Pure mapping
helpers go in `src/components/bode/eqGraphMath.ts`: `fForX`, `xForF`,
`dbForY`, `yForDb` given plot geometry, `snapQFromWheel(q, deltaY)` (log
steps, clamped to `Eq` limits), `hitNode(nodes, x, y, r)`; unit-tested.

### Playwright no-scroll check

- devDependency `@playwright/test`; `playwright.config.ts` with
  `use.channel: 'msedge'` (Edge is installed; override via `PW_CHANNEL`),
  `webServer: npm run dev -- --port 5177`, `reuseExistingServer`.
- `test/layout/noScroll.spec.ts`: for each viewport in
  `[[1440, 790], [1600, 880]]` open
  `/?mock=multi&ui=noveau`, wait for `.noveau-shell`, assert
  `document.documentElement.scrollHeight <= innerHeight` and `scrollWidth
  <= innerWidth`, and that no element with computed `overflow` auto/scroll
  actually scrolls (`scrollHeight > clientHeight + 1`), except elements
  carrying `data-scroll-ok` (none in this slice).
- `package.json` script `test:layout`. Not added to `npm test` or the
  pre-push hook (needs a browser); CI wiring is a follow-up.

## Waves

1. **Foundation** (`devOptions`, `App.svelte`, `app.css`, `ChannelList`
   extraction, `noveauUi`, `NoveauShell`, `IconRail`, `RailHead` + `SceneRow`
   + `VolumeBlock`, `RailFoot`, `StatusLine`, a placeholder `tune/TuneView`)
   in parallel with **Graph interaction** (`eqGraphMath.ts` + tests,
   `BodePlot` node layer).
2. **TUNE** (`EqGraph`, `OutputStage`, `InputStage`, `Toolbar`,
   `Inspector` + sections, real `TuneView`) in parallel with **Playwright**.

Each wave: `npm run check && npm run test && npm run lint`, an Opus code
review of the diff, fixes, then one commit.
