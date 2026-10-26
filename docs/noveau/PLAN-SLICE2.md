# Slice 2 — PROGRAM destination

Branch `exp/noveau`, behind `?ui=noveau`. Design: README §6.2 (PROGRAM), §6.7, §6.8;
mockup `v2-shell.html` (PROGRAM screen). Hard rules from PLAN-SLICE1 apply unchanged:
components call runtime verbs only, same write lanes as the classic panels, capability
gating intact, no scrollbars, 24 px rows, 11 px label minimum, tokens only, no dynamic
imports, `npm run test:layout` must pass.

## Budget at 1440×790

Workspace 762 px tall × 1184 px wide, padded 12/16 as the shell does (`.ws`).

| Area | Size |
| --- | --- |
| Chain strip | 72 px, full width |
| Gap | 12 px |
| Body | 654 px: Routing (left, `minmax(440px, 1fr)`) · gap 16 · Module (right, 480 px) |
| Routing map | header 28 + column header 24 + up to 9 output rows × 28 + legend 24 ≈ 330 px; the rest of the column stays free (crosspoint popover opens over it, anchored to the dot) |
| Module panel | header 28 + optional response curve 160 + rows; worst case Upmix 13 rows × 24 = 312 + 28 header ≈ 500 px — within 654 |

## Chain strip

Blocks in firmware order, each 28 px header (name, ENABLED switch when the module
has one) over an 11 px mono value line with up to two key values. States: lit (on),
dim (off), hatched (feature absent on this firmware: not rendered at all when the
feature flag is false — the console shows nothing the device cannot do). Clicking
a block sets `noveauUi.programModule`. Tube (fw V31) has no runtime verbs in the
console yet, so it is not in the strip in this slice.

Blocks and values: PREAMP (master dB · min/max of input preamps) · INPUT EQ (n
inputs with bands) · LEVELLER (speed · amount) · CROSSFEED (preset · freq) ·
LOUDNESS (ref SPL · intensity) · PSYBASS (cutoff · harmonics) · SUBHARM (low ·
high) · UPMIX (status · strength) · divider · MATRIX (n routes) · OUTPUT STAGE
(n enabled / n muted / limiter n on).

The block/value derivation is a pure function (`chainModel.ts`) with unit tests
on behaviour (gating, counts, formatting), not on constants.

## Routing map

Outputs as rows, inputs as columns, one dot per crosspoint: routed = pill tinted
with the input colour showing gain, inverted = ⌽ prefix, unrouted = ring, disabled
output = hatched row (still shows its real routes, as TUNE › Sources does). Click a
dot → crosspoint popover (ENABLE, GAIN slider + field, PHASE) using
`setCrosspointEnabled / setCrosspointGain / setCrosspointInvert`. Click a row
header → `selectChannel(outputId)` + `noveauUi.destination = 'tune'`. Columns come
from `matrixRows` (inputs), rows from the snapshot outputs (so disabled outputs
stay visible). Upmix context (parked reason) shown as the map caption
when the feature is present.

## Module panel

`modules/ModulePanel.svelte` switches on `noveauUi.programModule`. Every module:
28 px header (title, position caption, ENABLED switch), then inspector rows (label
84 px, control left-aligned next to it, as the TUNE stage). Masks (LOUD / PSY /
SUB output masks, leveller DET / APPLY, crossfeed pairs) render as chip rows
using `maskChipItems`. Parameters, ranges, verbs, lanes and gating are taken
from the classic panels in `src/components/processing/` one for one; nothing is
dropped. PREAMP: master preamp (when the feature exists) + per-input preamp
rows. The master preamp row is shown unconditionally (no capability flag; the verb is
scrub-lane and clamped). Response curves above the rows are deferred. INPUT EQ: per-input band count + "Edit in TUNE" jump. MATRIX: route count,
upmix status, "edit on the left". OUTPUT STAGE: per-output table (trim · delay ·
mute · limiter · GR) with a jump to TUNE; no editing here (TUNE owns it).

## Waves

- A1: ProgramView, ChainStrip (+chainModel), RoutingMap, CrosspointPopover, shell hook-up.
- A2: ModulePanel + modules (ModuleFrame, MaskChips, Preamp, InputEq, Leveller,
  Crossfeed, Loudness, Psybass, Subharm, Upmix, Matrix, OutputStage).
- Review (Opus), fixes, gate incl. `test:layout` with a PROGRAM case, commit.
