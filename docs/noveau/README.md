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

## 4. Recommendation

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
