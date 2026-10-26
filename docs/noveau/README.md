# Noveau — UI redesign proposal

Branch `exp/noveau`. Design-only: nothing here touches `src/`. Three mockups
(`a-signal-path.html`, `b-channel-strips.html`, `c-focus-dock.html`) open as
plain files; `tokens.css` is lifted from `src/app.css` so they sit on the
current palette and type.

Grounding: full read of `src/components/**`, `app.css`, `controls.css`, the
tab/state model, and a screenshot pass over all seven tabs at 1600×1000 in
`?mock=multi` (RP2350, 8-in/9-out, every feature gate open). The firmware
chain order comes from the DSPi README (PASS 1–5).

---

## 1. What the console shows today

### Inventory by tab

| Tab | Panels | Notes |
| --- | --- | --- |
| 01 OVERVIEW | Latest changes (changelog), merged response, routing summary, state KV, output list, quick reference | Mostly read-only mirrors of other tabs; changelog takes the prime slot |
| 02 EQUALIZER | Response plot, 10-band table, preamp (inputs) / xover + trim (outputs), AutoEQ modal | Only tab where rail selection does anything; table-only editing |
| 03 MIXER | Routing matrix (in×out; per-cell enable/gain/phase; per-output gain/delay/mute in header) | 72 identical cells in multi mode, nearly all OFF |
| 04 PROCESSING | Crossfeed, Leveller, Psybass, Loudness, Subharmonic, Upmix, Limiter | Seven modules; five of them repeat an "outputs 1…9" mask row |
| 05 PRESETS | 10 slot tiles, actions, includes-in-preset, startup, options | Half-empty at desktop size |
| 06 SYSTEM | Device, sys clock, pin map, input config, ADAT in/out, LG sync, outputs, I2S clock, DAC mute, debug ×3 | Dense, composed, scrolls |
| 07 CONTROL | Changes, control interfaces, display, control surfaces, macros, groups | Own SAVE/DISCARD idiom |
| chrome | Topbar (brand, tabs, 6 telemetry numbers, user volume, mute, bypass, dirty dot), rail (devices, preset chip, channels + meters), pending-changes dock, toasts, preset boundary modal | |

### Grouping by what the user is doing

The tabs slice by **control type** (EQ, mixer, processors, presets, hardware).
Users slice by **task**:

- **Listening** (every day, seconds at a time): volume, mute, bypass, switch
  preset, flip loudness / crossfeed on. Today: volume in the topbar, preset
  in the rail, loudness on tab 04, presets on tab 05.
- **Tuning a channel** (the core job, minutes to hours): for one output you
  touch EQ (xover, trim: tab 02), gain / delay / mute / phase / which inputs
  feed it (tab 03), limiter and whether it is in the leveller / loudness /
  psybass / subharm sets (tab 04, five different mask rows). Four tabs, zero
  shared selection except the rail highlight.
- **Shaping the stereo program** (occasional): preamp, input EQ, crossfeed,
  leveller, loudness, upmix, subharm. These are *program* processors on the
  input side of the matrix, yet they sit in the same grid as the per-output
  limiter.
- **Setting up hardware** (once, then rarely): pins, clocks, I/O types,
  control surfaces, UART/I2C, display. Two tabs, four different commit
  idioms (pending-changes dock, CONTROL CHANGES panel, sys-clock APPLY,
  display APPLY/REVERT).
- **Persisting / diagnosing** (rare): presets save/revert/copy, firmware,
  factory reset, telemetry, error counters.

### The firmware's own order

```
in preamp → input EQ → leveller → crossfeed → loudness → MATRIX → out EQ/xover → gain/mute → delay → limiter → master volume
            ───────── program (stereo, inputs) ─────────           ─────────────── per output ───────────────
```

The console never shows this. Processing lives in one grid regardless of
where it sits; the matrix is a separate destination; the output stage is
split between EQ (xover, trim) and MIXER (gain, delay, mute).

### What is working and should survive any redesign

- Token pipeline (oklch + color-mix, per-channel hue classes), the dark
  instrument identity, JetBrains Mono for values.
- Primitives: ValueField, SegmentedSelect, ToggleSwitch, LabeledSlider,
  ConfirmButton, Panel, KV. Real a11y, tests.
- The rail's channel list with LED meters and inline rename.
- Pending-changes dock as the one staged-commit surface (should become the
  *only* one).
- Preset tiles with active / dirty / startup legend; the boundary modal.
- Feature gating by capability: every proposal keeps "the UI shows what the
  firmware has".

### Pain points the redesign must answer

1. **Scattered channel work.** Tuning one output visits four tabs.
2. **Flat hierarchy.** Everything is 9–10 px mono uppercase; panel headers,
   labels, and values all have the same weight. Dense but not scannable.
3. **Uneven density.** EQ and PRESETS leave ~60 % of the viewport dark;
   PROCESSING and SYSTEM overflow. (Decided "keep" in July; a redesign
   reopens it.)
4. **Repeated mask rows.** "Which outputs" is asked five times in five
   places. It is a property of the output, not of the processor.
5. **Four commit idioms** for staged hardware changes.
6. **Overview is a changelog**, not a cockpit. It answers "what shipped",
   not "is anything wrong, what is the signal doing".
7. **Telemetry in prime space.** Six near-static numbers in the topbar
   centre; health is not surfaced as health.
8. **No direct manipulation.** The EQ graph is a picture; editing is a
   spreadsheet.

---

## 2. Three directions

They are deliberately different answers, not variants. Each has its own
information architecture *and* its own control language. Common to all
three: tabs go away as the primary navigation; selection (device, channel)
is global; staged changes commit through one dock; telemetry collapses to a
health indicator with a popover; the EQ graph becomes editable.

### A — Signal Path

*"The chain is the map."*

The workspace is a horizontal flow that mirrors PASS 1–5: input nodes with
meters → program blocks (preamp, EQ, leveller, crossfeed, loudness, upmix,
subharm) → the matrix as a compact crosspoint node → per-output lanes (EQ /
xover, trim, delay, limiter) → output nodes with meters. Blocks are lit when
enabled, dim when bypassed, dark when the firmware lacks them. Wires carry
channel hues. Clicking a block opens it in a bottom inspector drawer; the
flow stays visible so you never lose where you are. The flow doubles as the
overview: live meters at every node, clip / health badges on the node that
owns them.

Everything that is not signal (presets, hardware, control surfaces, device)
lives behind a slim left icon rail as full-page sheets with one shared
staged-commit dock.

Control language: schematic / patchbay. Rounded node cards, port dots,
bezier wires, state via light not via opacity. Mono stays for values and
port labels; a sans face at 12–13 px carries titles so headers finally
outrank labels.

Strengths: teaches the device; makes "where does loudness sit relative to
the matrix" visible; one place for every DSP control; the overview problem
disappears because the flow is the overview. Scales to multi-device (one
flow per device, switcher in the rail).

Risks: horizontal space on 8-in / 9-out is tight; the matrix node must
expand to a full editor; bottom drawer competes with the flow for height;
most engineering (layout engine, wire routing, drawer state).

### B — Channel Strips

*"The output is the unit of work."*

A console desk. One vertical strip per output (nine on RP2350), each stacked
top to bottom in signal order: source (which inputs feed it, with gain and
phase, replacing the matrix row), xover / EQ thumbnail, trim + delay + phase +
mute, limiter with GR meter, membership toggles for leveller / loudness /
psybass / subharm (the five mask rows become one column per strip), and a
tall LED meter. Input strips sit at the left (preamp, EQ thumbnail, meter).
A **master section** at the right holds the program processors (crossfeed,
leveller, loudness, upmix, subharm) and the user / master volume, like a
console's centre section.

Clicking any strip segment opens a **focus pane** that replaces the strip
area with the full editor (EQ graph with draggable bands, 10-band table as an
inspector, xover controls) while the strips collapse to a narrow meter bridge
so the whole desk stays in view. Presets are a **scene bank** across the top
(10 buttons, dirty dot, startup star). Hardware and control-surface setup is
a separate SETUP page with the single staged-commit dock.

Control language: hardware console. Vertical faders with dB scale for trim,
rotary-feel drag fields for frequency / Q (drag up-down, double-click to
type), LED ladders, per-strip hue strip at the top, section labels engraved
(dim sans caps) rather than boxed. Panels lose their borders; strips separate
by hairlines and spacing.

Strengths: directly solves pain point 1 (everything about an output in one
column); the mask rows collapse by construction; the meter bridge gives the
"is anything wrong" view for free; mixing-desk literacy transfers.

Risks: nine strips plus inputs plus master at 1600 px means ~120 px strips,
so the strip itself is summary-only and the focus pane carries the real
editing; input-side program processors need the master section to feel like
"the stereo program", not "misc"; RP2040 with five outputs looks sparse
unless strips widen.

### C — Focus + Dock

*"Fewer places, each one deep."*

Keep a sidebar, but with four intent-based destinations instead of seven
type-based tabs, and change the UI language far more than the structure.

- **LISTEN** — the daily surface: large user volume with mute, preset bank
  with dirty / revert, bypass, one-tap toggles for the program processors
  (crossfeed, loudness, leveller), the output meter bridge, and a health strip
  (link, clip, buffer, temp) that is dark when nominal. Replaces OVERVIEW and
  the topbar volume cluster.
- **TUNE** — one editor. Channel selector across the top (inputs then
  outputs, with meters). The EQ graph fills the page and is the editor: drag
  nodes for frequency / gain, wheel for Q, double-click to add, right-click
  for type and bypass. A right **inspector** shows the selected band, and
  below it the rest of that channel: for an output, sources (matrix row),
  trim / delay / phase / mute, limiter, processor membership; for an input,
  preamp and program processors. Replaces EQUALIZER, MIXER, and the per-output
  half of PROCESSING. The full matrix remains one click away as an overlay.
- **SETUP** — SYSTEM plus CONTROL as one scrolling page with a sticky section
  index (Device · Clocks · Inputs · Outputs · Pins · Interfaces · Surfaces ·
  Display), one staged-commit dock, diagnostics as a collapsible tail.
- **LIBRARY** — presets as a list with per-slot detail (what is included,
  startup), copy / paste, import / export, and A/B compare against the
  clipboard snapshot. Changelog and quick reference move here as "About".

A command palette (Ctrl+K) jumps to any control by name, using the existing
panel codes as anchors.

Control language: calm pro-app (think Linear or Figma inspector rather than
terminal). Sans for everything but values; a real type scale (title 14 /
label 11 / caption 10 / value mono 12); surfaces separated by spacing and
hairlines instead of bordered boxes; controls in inspector rows (label left,
control right) so density comes from alignment, not from 9 px type. Sheets
and popovers instead of grids of panels.

Strengths: smallest conceptual distance from today's state model (session,
mirror, staging all map one-to-one); biggest readability gain per unit of
work; the daily LISTEN surface is something the current UI simply lacks;
easy to ship incrementally (TUNE first, then LISTEN, then SETUP).

Risks: TUNE's inspector carries a lot (band, sources, trim, limiter,
membership) and must stay a single column; the program processors have a
less obvious home (LISTEN for toggles, TUNE-input inspector for parameters);
the matrix as an overlay demotes a view some users think in.

---

## 3. Side by side

| | A Signal Path | B Channel Strips | C Focus + Dock |
| --- | --- | --- | --- |
| Primary metaphor | schematic / patchbay | mixing desk | pro-app inspector |
| Navigation | flow canvas + icon rail | strips + focus pane + SETUP | 4 intents in a sidebar |
| Where an output's controls live | its lane in the flow | its strip | TUNE inspector |
| Where program processors live | blocks before the matrix | master section | LISTEN toggles + TUNE-input inspector |
| Matrix | compact node → expands | per-strip source rows | overlay from TUNE |
| Overview | the flow itself | meter bridge | LISTEN health strip |
| Repeated mask rows | per-lane chips | per-strip toggles | inspector membership |
| Hardware setup | sheets behind icon rail | SETUP page | SETUP page |
| Visual change from today | large | large | medium structure, large language |
| Engineering cost | highest | high | medium |
| Incremental path | hard (flow is all-or-nothing) | medium (strips first, focus pane reuses EQ) | easy (one destination at a time) |
| Multi-device fit | one flow per device | one desk per device | device switcher stays in sidebar |

---

## 4. Recommendation (v1, superseded by section 6)

Build **C** as the skeleton and borrow from the other two where they are
stronger:

- From **B**: the meter bridge and the per-output membership column. TUNE's
  inspector for an output is, in effect, one channel strip laid out
  vertically.
- From **A**: show the chain order explicitly in TUNE's channel selector and
  in the inspector section order, so the firmware's PASS order is visible even
  without a canvas.

Reasoning: C matches the state model we already have, lands the two biggest
user-facing wins (a daily LISTEN surface, an editable EQ graph) first, and
lets the type / surface language change ship under every destination as it
is rebuilt. A and B are stronger as a *picture* of the device; C is stronger
as a *tool* used every day, and the picture can be added later as A's flow in
LISTEN if it earns its place.

Suggested first slice: TUNE for one output in `?mock` (graph editor, inspector
with sources + trim + limiter + membership), with the new type scale and
surface language, behind a `?ui=noveau` flag. Review on hardware, then
LISTEN.

---

## 5. What a redesign does not change

- Runtime, protocol, transport, domain, state: untouched. Components read
  the mirror and call runtime verbs exactly as today.
- Capability gating: every control still appears only when the device has it.
- The staged-commit model: hardware writes stage; DSP writes apply live.
- Mobile: still out of scope; the splash stays.

---

## 6. Solidified direction (v2, after review)

An independent critique (`REVIEW-2026-10-25.md`) was run against the three
directions with the owner's primary constraint as its lens:

> The interface must stay fully usable in an almost-fullscreen desktop
> browser window with no scrolling anywhere. No page scroll, no per-panel
> scrollbars, unless the screen is genuinely small. It should feel like a
> native app, not a web page.

The review stands. Its main findings, accepted here:

- **C fails its own constraint as mocked.** The TUNE inspector scrolls
  (five stacked sections, ~1050 px against ~680 px available), LISTEN
  scrolls, SETUP was specified as a scrolling page.
- **Height is the binding axis, not width.** A 1440×900 laptop gives about
  790 px of viewport; a 1920×1080 Windows laptop at 125 % scaling gives about
  740. 1600×1000 is a best case, not a reference.
- **LISTEN as a destination is wrong.** The daily controls must stay
  reachable while tuning, so they belong in the chrome; once they are there,
  LISTEN has nothing left.
- **A's drawer and B's strips are both summary-only** for the core task;
  B's focus pane *is* C's TUNE, and A's canvas cannot hold a 10-band editor.
- **Program processors were homeless in C** (toggles on one page,
  parameters in an input inspector, although crossfeed, upmix, leveller are
  stereo or global, not per input). Psybass parameters and the V32 tube
  preamp appeared in no direction.

### 6.1 Floor and shell

| | |
| --- | --- |
| Design floor | **1400 × 740** logical (fits 1440×900 Mac and 1536×864 scaled Windows) |
| Reference | 1600 × 880 |
| Page | `html, body { overflow: hidden }`; app is a `100dvw × 100dvh` grid with `min-width: 1400px; min-height: 740px` |
| Below the floor | single page-level pan of the 1400×740 canvas, as today. No reflow, no compact mode. Below ~1000 px wide the existing splash. |

Fixed rows: **top bar 44 px**, **status line 28 px**. The workspace gets
668 px at the floor. Only the EQ graph, the meters and the chain strip
absorb leftover space; everything else has an intrinsic height sized for
the worst case (8-in / 9-out, every feature gate open).

Shell regions, left to right:

1. **Icon rail, 56 px** (from A): TUNE · PROGRAM · SETUP, plus LIBRARY (opens
   a sheet) and DEVICE. Replaces C's 200 px sidebar.
2. **Channel rail** (today's, kept): devices, channel list with LED meters,
   inline rename. It is the selector *and* the meter bridge. Disabled
   outputs collapse to a 24 px stub (from B).
3. **Workspace** for the active destination.

**Top bar, 44 px, on every screen** (from B's scene bank and C's LISTEN):
preset scene bank (10 slots, dirty dot, startup star, inline Save / Revert
on the active one) · quick toggles for the program processors (name + one
value) · user / master volume with mute · bypass · health dot with a
popover (CPU, rate, clock, voltage, temp, clip, buffer; tiles dark when
nominal).

**Status line, 28 px**: fw · wire · rate · link · "nothing staged" or
"2 changes · Apply · Discard", expanding upward as a popover. The
pending-changes dock stops floating over content, and it is the *only*
staged-commit idiom (CONTROL's CHANGES panel, sys-clock APPLY and display
APPLY/REVERT all fold into it).

### 6.2 Destinations

**TUNE** — the selected channel, from the rail. Budget at the floor (668 px):

| Area | Content | Height |
| --- | --- | --- |
| Graph | editable EQ graph: drag nodes (freq / gain), wheel Q, double-click add, right-click type / bypass, value callout, cursor readout | ~430, elastic |
| Under graph | output stage in two rows: trim · delay · phase · mute · limiter thr / rel / GR · link; membership chips LEV · LOUD · PSY · SUB (replaces the five mask rows). For an input: preamp, link L/R. | 72 |
| Under graph | toolbar: Add band · AutoEQ… · Copy · Paste · Reset · Link with pair | 32 |
| Right inspector, 300 px | selected band (type, freq, gain, Q, bypass) | 120 |
| | 10-row band table, 24 px rows (kept: the graph alone is too imprecise) | 260 |
| | sources: the full matrix column for this output, 8 × 24, gain + phase inline | 220 |

Inspector total ~600 px inside 668. Nothing hides behind "6 more…".

**PROGRAM** — the stereo program and routing, in firmware order:

- Chain strip across the top, 72 px (from A): PREAMP · INPUT EQ · LEVELLER ·
  CROSSFEED · LOUDNESS · PSYBASS · SUBHARM · UPMIX · TUBE (V31) · MATRIX ·
  OUTPUT STAGE, each lit / dim / hatched with on-off and two key values.
  Clicking a block selects it.
- Left: the **full matrix**, permanently visible: 8 × 9 cells at 32 px
  (~340 × 320); cell gain and phase edit in a popover. The matrix is not
  "one click away", it is on screen.
- Right: the selected module's parameters in a fixed area sized to the
  worst case (upmix, 13 rows × 24 = 312 px). Limiter link groups live here;
  per-output GR shows on the rail meters.

**SETUP** — SYSTEM + CONTROL, paged by a segmented control, one commit idiom:
Device · Clocks & I/O · Pins · Interfaces · Surfaces · Display · Diagnostics.
Every page is designed against the 668 px budget. Surfaces, macros, groups
and display pages use master–detail lists sized to the firmware maxima,
which are all fixed: 16 bindings, 8 groups, 8 macros, 16 IR commands,
16 display pages (`src/domain/controlSurfaces.ts`). No page scrolls.

**LIBRARY** — a sheet, not a destination: preset detail per slot (included
sections, startup), copy / paste, import / export, A/B against the
clipboard snapshot, changelog and quick reference under "About".

### 6.3 Density rules

| Element | Size |
| --- | --- |
| Inspector / table rows | 24 px |
| Section headers | 28 px |
| Labels | 11 px sans, minimum |
| Values | 12 px mono, tabular |
| Axis ticks only | 10 px |
| Gutters | 12 / 16 px |

Nothing at 9 px. Surfaces separate by spacing and hairlines; at most one
level of card.

Overlays that are allowed: AutoEQ browser, matrix cell popover, health
popover, LIBRARY sheet, command palette (Ctrl+K).

Whitelisted scroll regions, and only these: the event log, the changelog
in About, AutoEQ results.

### 6.4 Enforcement

A Playwright check runs every destination (and every SETUP page) at
1400×740 and 1600×880 in `?mock=multi` and asserts:

- `document.scrollHeight <= innerHeight` and `scrollWidth <= innerWidth`;
- no element has `scrollHeight > clientHeight` except the whitelist above.

A new scrollbar in a PR is a design defect, not a layout detail.

### 6.5 Kept from each direction, and cut

Kept — from **A**: icon rail, PASS-order chain strip, always-visible matrix
map, lit / dim / hatched legend, clip badges on the owning node. From
**B**: scene bank in the chrome, per-output membership toggles, disabled
outputs as stubs, persistent status line. From **C**: inspector rows and
type scale, draggable graph with value callout, link-with-pair toggle,
dark-when-nominal health tiles, Ctrl+K.

Cut: LISTEN as a page, the 200 px nav sidebar, horizontal channel chips,
"6 more…" truncation, tall faders, the canvas as an editor, the "Recent"
list, SETUP as a scrolling page, the matrix as an overlay.

### 6.6 Forks, decided by the owner (2026-10-25)

1. **Floor: 1440 × 790.** The easier budget first; tighten later if a
   1536×740 case matters (it pans until then). Workspace height at the
   floor is 762 px (790 minus the 28 px status line).
2. **Stereo pair as the unit: no.** Channels stay individual; pair
   behaviour stays the #138 link mechanism, which is already configurable.
3. **Matrix: keep the capability, not the grid.** The 8×9 grid was
   convenient but simplistic. Any routing view is fine as long as no
   function is lost: per-crosspoint enable / gain / phase, per-output
   gain / delay / mute. See 6.2 PROGRAM for the replacement.
4. **No permanent top bar.** The always-on volume strip was an early
   decision and is removed. Daily controls move into the channel rail head,
   which is always visible anyway. The shell has no chrome row above the
   workspace.

### 6.7 Shell, revised for 6.6

Left to right, full height:

1. **Icon rail, 56 px**: TUNE · PROGRAM · SETUP · LIBRARY (sheet) · DEVICE.
2. **Channel rail, ~200 px**, the console's always-on column:
   - head: device chip; preset **scene row** (10 small slots, active
     highlighted, dirty dot, startup star; Save / Revert appear on the active
     one when dirty); **volume** (user / master axis toggle, slider, mono
     readout, mute); **bypass**;
   - body: inputs and outputs with LED meters, as today; disabled outputs
     as 24 px stubs;
   - foot: health dot + one-line status ("nominal" or the first fault),
     opening the health popover.
3. **Workspace**: the active destination, 762 px tall at the floor.
4. **Status line, 28 px**, bottom, full width: fw · wire · rate · link,
   and the staged-commit dock ("nothing staged" / "2 changes · Apply ·
   Discard", expanding upward).

Quick toggles for the program processors are no longer chrome: PROGRAM's
chain strip carries them, and the rail's scene row covers the daily
"switch preset" case.

### 6.8 Routing without the grid (decision 3)

Two views, both editing the same crosspoints:

- **TUNE › Sources** (per output): the full column for the selected output,
  8 rows × 24 px, each row: input name · enable · gain field · phase. This
  is where routing is *edited* while tuning.
- **PROGRAM › Routing map**: a compact map, outputs as rows, inputs as
  columns, one dot per crosspoint (lit = routed, with gain tint; ⌽ glyph
  for inverted). It is the overview that the grid gave, at a quarter of the
  height. Clicking a dot opens the crosspoint popover (enable, gain, phase);
  clicking a row header jumps to that output in TUNE. Per-output gain /
  delay / mute sit in TUNE's output stage, not in the map.

Nothing is lost: every crosspoint field is editable in two places, and the
whole-device picture stays on screen.

### 6.9 First slice

A v2 mockup (`v2-shell.html`: TUNE and PROGRAM at 1440×790, zero scroll
regions, verified by script), then TUNE for one output in `?mock=multi`
behind `?ui=noveau` with the shell from 6.7, the budget, the density rules
and the Playwright no-scroll check from day one. Then PROGRAM, then SETUP
page by page.
