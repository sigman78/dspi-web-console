# Slice 3 — SETUP destination

Branch `exp/noveau`, behind `?ui=noveau`. Design: README §6.2 (SETUP). Hard rules from
PLAN-SLICE1 apply: runtime verbs only, capability gating intact, no scrollbars, tokens
only, `npm run test:layout` must pass.

## Approach

SETUP replaces the classic SYSTEM and CONTROL tabs. Stage 1 (this slice) reuses the
classic panels from `src/components/system/` unchanged in behaviour and arranges them
on fixed pages that fit the budget; only the panel chrome is restyled to the noveau
density. Stage 2 rebuilds the control-surface editors (bindings, macros, groups,
display pages) as master–detail lists sized to the firmware maxima (16 / 8 / 8 / 16),
because at full occupancy the classic card list cannot fit any fixed height.

## Budget at 1440×790

Workspace 762 × 1184, padded 12/16 → 738 tall. Page selector 28 px + 12 px gap →
page body 698 px tall, three columns of (1184 − 32 − 2×16) / 3 ≈ 373 px.

Measured classic panel heights on the full mock surface (`?mock=multi`, px):

| Panel | h | Panel | h |
| --- | --- | --- | --- |
| DEVICE | 350 | OUTPUTS | 206 |
| SYSTEM CLOCK | 292 | I2S CLOCK | 203 |
| PIN MAP | 268 | ADAT OUTPUT | 130 |
| INPUT CONFIG | 440 | DAC HW MUTE | 208 |
| ADAT INPUT | 159 | TELEMETRY | 262 |
| LG SOUND SYNC | 138 | ERROR COUNTERS | 342 |
| CONTROL INTERFACES | 187 | BUFFER STATS | 307 |
| DISPLAY (empty) | 561 | CHANGES | 101 |
| CONTROL SURFACES (empty) | 126 | MACROS / GROUPS (empty) | 123 |

Noveau chrome trims each header from ~37 px to 28 px.

## Pages (segmented control, 28 px)

| Page | Column 1 | Column 2 | Column 3 |
| --- | --- | --- | --- |
| Device | DEVICE | LG SOUND SYNC · DAC HW MUTE | — |
| I/O | SYSTEM CLOCK · I2S CLOCK (495) | INPUT CONFIG · ADAT INPUT* (599) | OUTPUTS · ADAT OUTPUT* · PIN MAP (604) |
| Interfaces | CONTROL INTERFACES* | — | — |
| Surfaces | CONTROL SURFACES* (list) | BINDING (detail host) | IR COMMANDS (detail host) |
| Macros & Groups | MACROS* over GROUPS* (lists) | MACRO (detail host) | GROUP (detail host) |
| Display | DISPLAY* | DISPLAY PAGE (detail host) | — |
| Diagnostics | TELEMETRY | ERROR COUNTERS | BUFFER STATS |

`*` = gated exactly as the classic tabs gate it (`features.adatInput`, `adatOutput`,
`controlInterfaces`, `controlSurfaces`, `CsField.displaysAvailable / macrosAvailable /
groupsAvailable(caps)`). A page whose every panel is gated off is not offered in the
selector. Diagnostics is a regular page in noveau (classic hides it behind `?debug`).
Pins are not a separate page: PIN MAP lives on I/O.

Surfaces and Display exceeded the budget with the classic stacked cards; stage 2 splits them.

## Chrome adaptation

`SetupView` applies `:global` overrides to `section.panel` within `.setup` only: header
28 px (padding 0 12px), `.code` hidden, title 11 px sans 600 letter-spacing 0.5px,
`backdrop-filter` off, `--radius-m`. Panel bodies keep their own layout.

## State and tests

`noveauUi.setupPage: SetupPageKey` (default 'device'). Layout spec case "SETUP every
page": click SETUP, click each selector option, scan. Unit test: the page list is
derived from features/caps (pages drop out when gated off).

## Stage 2 — split layout

The control-surface editors keep their classic components; only where their open slot
renders changes. Each list panel receives `detailTarget` and portals the open item's
editor into a `.detail` host in another column (28 px header, hint hidden once content
arrives, `data-budget`, `overflow: hidden`). Surfaces: list, BINDING host, IR COMMANDS
host (`irDetailTarget`, empty with a hint unless the open control is an IR receiver).
Macros & Groups: both lists stacked in column 1, hosts in columns 2 and 3. Display:
config plus page strip in column 1, DISPLAY PAGE host in column 2.

Detached modes: a macro shows one open step at a time, an IR receiver shows one open
command at a time, so the hosts stay inside the budget at full occupancy.

The CHANGES panel is gone from the columns. `CsChangesStrip` sits right-aligned in the
page-selector row on Surfaces, Macros & Groups and Display (only with
`features.controlSurfaces`): UNSAVED pill when dirty, `changed: ...` or `nothing changed`,
`unapplied: ...` in warn, SAVE and DISCARD with the same disabled rules as the classic panel.
Layout spec also adds one control on Surfaces and re-scans.
