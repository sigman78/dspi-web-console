# Slice 4 — LIBRARY sheet

Branch `exp/noveau`, behind `?ui=noveau`. Design: README §6.2 (LIBRARY is a sheet, not a
destination). Hard rules from PLAN-SLICE1 apply.

## Shape

LIBRARY opens as a sheet over the workspace: 640 px wide, anchored right, full workspace
height (762 px at the floor, between the channel rail and the right edge, above the status
line), with a scrim over the rest of the workspace. The icon-rail LIBRARY button toggles
it (`noveauUi.libraryOpen`, `aria-pressed`); the destination underneath does not change.
Escape, the scrim, and the × close it. Focus moves into the sheet on open and returns to
the LIBRARY button on close. The sheet is a budget container (`data-budget`), nothing in
it scrolls.

Header 28 px: "LIBRARY" · segmented PRESETS | ABOUT · ×.

## PRESETS page

Two columns inside the sheet (gap 16): slots 280 px, detail the rest.

**Slots**: 10 rows × 28 px: index (mono), name or "[unnamed]" (dim), pills: ACTIVE,
STARTUP (warn ring style as the rail), unsaved underline when active and dirty, COPIED
when the clipboard holds this slot. Click selects the row for the detail column; the
active slot is selected by default. Legend row at the bottom.

**Detail** (selected slot): name row with inline rename (same rules as the rail:
dblclick / Enter / F2, `renamePresetSlot`), state caption ("active · unsaved changes",
"empty", "startup"). Actions as 24 px rows grouped:

| Group | Actions | Verb / gate (same as PresetControls / PresetTile) |
| --- | --- | --- |
| Slot | LOAD (not active), SAVE (active; `saveActivePresetNamed`), REVERT, DELETE | `loadPresetSlot` (boundary modal on dirty), `revertActivePreset`, `deletePresetSlot` |
| Clipboard | COPY / DROP, PASTE | `copyActivePreset` (active, occupied, clean), drop clears `copySource.held`, `pastePresetTo` (held, target ≠ source) |
| Startup | SET AS STARTUP | `setStartupDefault` |
| Transfer | EXPORT, IMPORT | see below |

Below the actions, device-wide rows (24 px, ToggleSwitch): STARTUP = last active
(`setStartupMode`), MASTER VOLUME stored with preset (`SaveMasterVolumeButton` logic /
`masterVolumeMode`), OUTPUT CONFIG stored with preset (`setOutputConfigMode`). Error line
for `lastActionError` with dismiss. Loading / fetch-error states as the classic tab.

## EXPORT / IMPORT

Classic stubs these. Here: EXPORT downloads the held clipboard as JSON
`{ kind: 'dspi-preset', version: 1, name, fwVersion, wire, blob (base64) }` — it needs a
COPY first, so the button is enabled only while the clipboard holds a preset. IMPORT
opens a file picker, parses with `parsePresetTransfer` (pure, `src/domain/presetTransfer.ts`,
tested), refuses when `kind`/`version` mismatch or when `fwVersion`/`wire` differ from the
connected device (message in the error line), and otherwise pastes into the selected slot
through `pastePresetTo` with the same boundary rules as PASTE. No new wire commands.

Two pure helpers in `src/runtime/presets.ts` keep the component free of protocol codec use: `exportHeldPreset(s)` (filename + JSON text, fw tag built from the structured `caps.fw`, beta included) and `decodeImportedPreset(s, text)` (envelope parse, platform check, blob `formatVersion === caps.wire`, precise reasons; a file without `fwVersion` is refused as having no firmware tag). After a successful import paste the slot is renamed to the file's name when non-empty and different.

SET AS STARTUP is gated off for empty, inactive slots. ABOUT > CHANGES shows the latest 6 highlights (`LatestChangesPanel` `limit` prop) with a link to the repo CHANGELOG. Selecting a rail destination closes the sheet.

A/B audition against the clipboard needs a restore-without-save verb that does not exist
yet; deferred, noted in the sheet as nothing (no disabled stub).

## ABOUT page

Reuses the Overview tab's LatestChangesPanel and QuickRefPanel bodies, stacked or under a
second segmented control (CHANGES | QUICK REF) if they do not fit the sheet height;
measured in the mock.

## State and tests

`noveauUi.libraryOpen: boolean`, `librarySlot: PresetSlot | null`. Unit tests: slot-row
state derivation (active/startup/dirty/copied), `presetTransfer` parse/serialize round
trip and refusals. Layout spec: open LIBRARY on TUNE and on SETUP, scan both pages of the
sheet.
