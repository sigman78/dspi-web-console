# Slice 4 — PRESETS flyout (replaces the LIBRARY sheet)

Branch `exp/noveau`, behind `?ui=noveau`. Hard rules from PLAN-SLICE1 apply.

Owner verdict on the first LIBRARY cut (2026-10-26): the rail is a list of destinations,
so a toggle there reads as a broken tab; presets and release notes share nothing; a slot
list plus a separate detail column with captioned button groups is the classic tile
transplanted, not a redesign. Decisions: trigger is the preset name field in the
rail head (dropdown look); ABOUT is dropped from noveau for now; every action lives inline on the row
it acts on; device-wide preset options move to SETUP › Device.

## Shape

`PresetsFlyout` renders inside `RailHead` (same pattern as the health popover in
`RailFoot`): absolutely positioned, anchored at the rail head's right edge and top, 400 px
wide, intrinsic height (header 28 + 10 rows × 28 + optional error line), z-index above the
workspace, no scrim. Toggle: the full-width name field in `SceneRow`, styled like a dropdown with a chevron at its right edge (`data-presets-toggle`, `aria-expanded`, `aria-haspopup="dialog"`, `noveauUi.presetsOpen`). The rail head has no inline rename; renaming lives only in the flyout rows. SAVE and REVERT follow the field as 20 px icon buttons ("Save preset" / "Revert preset"). Closes on
Escape (unless a boundary prompt is pending or the event is already handled), pointerdown
outside the rail head, the × in the header, or a rail destination click. Focus moves to the
first row on open and back to the name field on close. `role="dialog" aria-modal="false"
aria-label="Presets"`, `data-budget`.

Header one line: PRESETS · ×. Loading and fetch-error (RETRY) states as the classic tab.

## Rows (28 px, grid `24px minmax(0,1fr) auto`)

- **Index**: digit button in mono 12 px. Startup slot carries the warn ring + glow used by
  the rail digits. Click sets this slot as startup (`setStartupMode(Specified)` if needed,
  then `setStartupDefault`); disabled when already startup or when the slot is neither
  occupied nor active.
- **Name**: inline rename (dblclick / Enter / F2, `renamePresetSlot`);
  `[unnamed]` dim for occupied/active without a name, `empty` faint italic otherwise.
  Active row has the accent tint; unsaved = 2 px warn underline on the name. A dashed
  COPIED pill follows the name on the clipboard source row. No ACTIVE / STARTUP pills.
- **Actions**: intrinsic-width chips, right-aligned, 20 px tall, 11 px sans 600, from a pure
  `rowActions()` (tested) keyed on the row state. Only the active row's SAVE and REVERT
  (20 px icon buttons) are always visible; every other chip is `quiet`: `visibility: hidden`
  until the row is hovered or has focus within (kept in the DOM, so row height and chip
  positions never shift and keyboard reach is preserved).

| Row state | Chips |
| --- | --- |
| active | SAVE (accent; dirty or slot unsaved), REVERT (occupied and dirty), COPY (occupied, clean, clipboard empty), PASTE (clipboard holds another slot) |
| active, never stored | SAVE, IMPORT (plus PASTE when the clipboard holds another slot) |
| clipboard source (`held.slot === slot`) | DROP, EXPORT (in addition to the above when active) |
| occupied, not active | LOAD, PASTE (only while the clipboard holds another slot), DELETE (ConfirmButton, confirm label CONFIRM, danger) |
| empty | PASTE (only while the clipboard holds something), IMPORT |

EXPORT exports the clipboard (`exportHeldPreset`), so it appears only on the copied row;
IMPORT (`decodeImportedPreset` → paste → rename) appears only on empty rows. Pasting into
a non-active slot loads it first through the normal boundary prompt. Actions are ignored
while `s.presets.busy` (chips are not greyed). Error line (`lastActionError` or the import reason) with dismiss
at the foot.

## SETUP › Device

New `PresetOptionsPanel` (classic `Panel` chrome, title PRESETS) in the empty third
column: four 24 px rows with a `ToggleSwitch`: boot into last active (`setStartupMode`),
master volume stored with preset (`setMasterVolumeMode`), output config stored with preset
(`setOutputConfigMode`), warn when switching with unsaved changes
(`settings.warnOnPresetSwitchDirty`). Fetches preset info on mount when the directory is
unknown; toggles disabled until it is.

## Removed

Rail LIBRARY entry, `LibrarySheet`, `SlotList`, `SlotDetail`, the ABOUT page and the
`LatestChangesPanel.limit` prop (classic file restored). Store: `libraryOpen /
libraryPage / libraryAbout / librarySlot` → `presetsOpen`. Runtime helpers and the
`presetTransfer` domain module stay.

## Tests

`slotRows` and `rowActions` unit tests. Layout spec: open the flyout on TUNE, hover a row to reveal its chips, rename a
row, open it on SETUP; SETUP › Device shows the PRESETS panel; scan each.
