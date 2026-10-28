# Console UI

Design record for the console shell, its destinations and the rules new UI
follows. It describes the UI as shipped. Code lives under
`src/components/noveau/` (feature views), `src/components/chrome/`
(shared primitives) and `src/styles/` (tokens and recipes).

## 1. Purpose

The console is a desktop instrument for tuning a DSPi, not a web page. The
thesis, in order of precedence:

1. App feel: nothing reflows or jumps when a value changes.
2. No scrollbars: no page scroll and no panel scroll at the layout floor. A
   new scrollbar is a defect, not a layout detail.
3. Three columns: dense pages use three equal columns; a pin map or detail
   host takes the third.
4. One layout per panel, sized for the worst case (8 inputs, 9 outputs, every
   capability present), never a compact and a roomy form.

The UI shows what the firmware has: a control for a missing capability is not
rendered, and one that is unavailable right now is disabled with a reason where
one fits.

## 2. Frame

### 2.1 Floor and shell

The layout floor is 1440 x 790 logical px (`body { min-width: 1440px;
min-height: 790px }`); the reference is 1600 x 880. Below the floor the page
pans as one unit, with no reflow and no compact mode; below about 1000 px wide
the mobile splash shows. Height is the binding axis: a 1440 x 900 laptop gives
about 790 px of viewport. Every budget below is stated at the floor.

`NoveauShell` is a grid: columns `56px 200px 1fr`, rows `1fr 28px`.

Regions: the 56 px icon rail (TUNE, PROGRAM, SETUP, CONTROL, ABOUT pushed to
the bottom), the 200 px channel rail, the workspace (1184 x 762, padded
12 / 16, content box 1152 x 738) and the full-width 28 px status line (fw,
wire, rate, link; project links; staged reminder).

There is no top bar. The daily controls live in the channel rail head, which
is always visible.

Channel rail:

- Head: device switcher; preset scene row (10 slots as 2 x 5, startup ring,
  unsaved underline); a name field that opens the preset editor flyout, with
  Save and Revert icon buttons; volume (User | Master axis, slider, mono
  readout); mute and bypass icon buttons side by side. Rail-head icon buttons
  are 22 x 22 with a 14 px glyph.
- Body: inputs and outputs with LED meters and inline rename; disabled outputs
  are 24 px stubs; in TUNE the locked EQ-link peers are tinted.
- Foot: health dot and state (Nominal, Degraded, Error, Idle), opening the
  health popover (CPU0/1, rate, clock, voltage, temperature, CLEAR CLIPS).

Only the EQ graph, the meters and the chain strip absorb leftover space;
everything else has an intrinsic height sized for the worst case.

### 2.2 Paged workspaces

SETUP and CONTROL use `PagedWorkspace`: a 28 px tab strip (`role=tablist`,
arrow keys wrap, Home / End) above a 698 px page body of three columns (16 px
gap, about 373 px each). Columns clip and carry `data-budget`. A right-aligned
slot in the strip row hosts the commit strips (2.4). A page whose panels are
all gated off is not offered.

### 2.3 Popovers and flyouts

Overlays: the presets editor flyout, health popover, staged changes list,
crosspoint popover, band context menu, AutoEQ browser, preset-boundary modal
and confirm modal.

- Flyouts and popovers use `use:dismiss` (Escape, outside pointerdown) and
  `--z-pop` / `--z-flyout`; modals use the shared `Modal` and `--z-modal`;
  toasts sit above modals (`--z-toast`). Only true modals have a scrim.
- A popover never covers what it references: the presets flyout opens right
  of the rail head, the health popover above the rail foot, the staged list
  below the strip, the crosspoint popover on its dot.

### 2.4 Where "not yet applied" surfaces

Two kinds of pending state, each in one place: staged (hardware or I/O
configuration waiting for APPLY) in SETUP, and drafts (control-surface edits
not yet saved) in CONTROL.

- Staged changes are counted in the status line ("N staged" with a SETUP
  hint, or "nothing staged"; clicking jumps to the first staged page). APPLY
  and DISCARD live in the `StagedStrip` in the page-strip row of SETUP and
  CONTROL. The count opens a list with a per-entry discard. A disruptive
  apply (audio mute, clock reboot) turns APPLY into a two-step ConfirmButton
  with the reason beside it. Staged pages carry a warn dot on their tab.
- Drafts (surfaces, IR, macros, groups, display) live in the `drafts` store,
  survive page changes, and are counted by the unload and device-switch
  guards. CONTROL page tabs carry a dot while a page holds a draft.
  `CsChangesStrip` in the page-strip row shows the UNSAVED pill, the changed
  and unapplied summaries, SAVE and DISCARD.
- Unsaved preset changes are a warn underline on the scene slot and name, plus
  the Save icon.

Colour semantics: accent dot for a draft, warn dot for staged, warn underline
for an unsaved preset.

## 3. Destinations

`noveauUi.destination` is `tune | program | setup | control | about`. The rail
hides CONTROL when `features.controlSurfaces` is false; the shell redirects to
SETUP if the destination vanishes.

### 3.1 TUNE

The selected channel from the rail. Left column: header, editable EQ graph
(elastic, 300 to 440 px), stage row, 32 px toolbar. Right: 300 px inspector.

- Graph: drag a node for frequency and gain, wheel for Q, double-click an
  empty spot to add a band, right-click for type and bypass. Crossover bands
  are diamonds that move in frequency only. Drag keeps a local draft and
  commits once on release.
- Output stage (outputs): trim, delay, mute, enabled, limiter (toggle,
  threshold, release, link group, live GR), and LOUD / PSY / SUB membership
  chips. Input stage (inputs): preamp and the leveller DET / APPLY chips.
  Membership replaces the per-processor output mask rows.
- Toolbar: add band, AutoEQ, copy / paste / exit, reset, link toggle (when
  the channel is in a link group).
- Inspector: selected band (type, freq, gain, Q, bypass), the 10-row band
  table, and Sources, the full crosspoint column for the output (or the
  transposed list for an input) with enable, gain and invert per row.

Band selection (`noveauUi.selectedBand`) is set by graph click, table row or
focus, add, and the context menu. It is dropped on a channel switch and when
the selected band is reset to Flat after having been in use.

### 3.2 PROGRAM

Stereo program and routing in firmware order. Chain strip (88 px):

`PREAMP > INPUT EQ > LEVELLER > UPMIX > MATRIX > CROSSFEED > SUBHARM > PSYBASS
> LOUDNESS > OUTPUTS`

Each block shows its state (lit, dim) and one or two key values; blocks for
absent features are not rendered. Modules are selectable and carry a blurb.
The OUTPUTS anchor shows counts (`7 on, 2 muted, lim 3`) and jumps to TUNE.
Body: routing map left, selected module panel (480 px) right, sized for the
worst case (Upmix, 13 rows).

Routing map: outputs as rows, inputs as columns, one dot per crosspoint (lit
and tinted when routed, inverted marked, disabled outputs hatched). A dot opens
the crosspoint popover (enable, gain, phase); a row header selects that output
in TUNE. The same crosspoints are editable in TUNE Sources.

Every module keeps the parameters, ranges, write lanes and gating of its
firmware feature, laid out as `.prow` rows.

### 3.3 SETUP

Pages: INPUTS, OUTPUTS, DEVICE, INTERFACES (`setupPages.ts`). INTERFACES is
offered only with `features.controlInterfaces`.

- INPUTS: input config; ADAT input (gated) with LG Sound Sync; pin map.
- OUTPUTS: outputs with ADAT output (gated); I2S clock with DAC HW mute; pin
  map.
- DEVICE: device with system clock; firmware; telemetry, error counters and
  buffer stats.
- INTERFACES: control interfaces (UART, I2C); pin map.

The pin map is a permanent right-hand reference column on INPUTS, OUTPUTS and
INTERFACES, never a toggle. Hardware config changes are staged (section 2.4).

### 3.4 CONTROL

Present only with `features.controlSurfaces`. Pages (`controlPages.ts`):
SURFACES, MACROS & GROUPS, DISPLAY; a page drops out when its capability
(`macrosAvailable`, `groupsAvailable`, `displaysAvailable`) is absent.

The editors are master-detail, sized to the firmware maxima (16 bindings,
8 groups, 8 macros, 16 IR commands, 16 display pages). A list panel portals
the open item's editor into a detail host in another column, so the page never
grows: SURFACES is list, BINDING, IR COMMANDS (IR receivers only); MACROS &
GROUPS stacks both lists with MACRO and GROUP hosts; DISPLAY is config and
page strip with a DISPLAY PAGE host. Macro steps and IR commands open one at
a time.

### 3.5 ABOUT

Console (version, build, mock profile, WebUSB), LATEST CHANGES, the connected
device (firmware, platform, wire, serial) and project links, on the
three-column grid without a selector.

### 3.6 Landing and capability degradation

Landing rule (`landing.ts`, called once after settings restore): ABOUT on the
first run or the first launch after a console update
(`settings.seenVersion !== APP_VERSION`), otherwise TUNE.

Capability gating by feature flag:

- `controlSurfaces`: CONTROL rail item and destination absent.
- `controlInterfaces`: SETUP INTERFACES page absent.
- `limiter`, `psybass`, `subharm`, `upmix`: stage column, chips, chain block
  and module absent.
- `adatInput`, `adatOutput`: ADAT panels absent.
- CS caps: MACROS & GROUPS and DISPLAY pages follow the caps.

Rule: capability missing means hidden; runtime condition means disabled with a
reason (for example "Turn MCK off to change its pin").

Keyboard: Alt+1 to Alt+5 open destinations by rail position (CONTROL drops
out when absent, so the keys after it shift), Alt+[ and Alt+] cycle. ABOUT
lists them.

## 4. Density and style

### 4.1 Rules

- Icons, not chips, for actions with a recognisable glyph. A text chip is for
  a verb with none (APPLY, DISCARD) or a state that needs a word.
- Controls take their intrinsic size; nothing is stretched to fill a column.
- Dense blocks use inline KV rows (label left, value right), not tile grids.
- The pin map is permanent where it applies. A popover never covers what it
  references.
- One idiom per intention: one way to stage, confirm and rename.
- Buttons and sentences are sentence-case sans; mono caps are for tags,
  identifiers and short labels. Mono is for numbers, units, identifiers and
  tags, with tabular figures; labels and prose are sans.
- Minimum text size is 11 px; 10 px only for axis ticks and tags.
- Channels carry a hue (`chShade`, `.ch-*`) wherever one is named: rail rows,
  graph curves, routing dots.
- At most one level of card; surfaces separate by spacing and hairlines.
- One dim layer: a disabled control is dimmed once (`--dim-disabled`), an off
  feature's content once (`--dim-off`), never both stacked.

### 4.2 Sizes

Rows (inspector, table, `.prow`) are 24 px (`--h-row`), section and panel
headers 28 px (`--h-head`), controls 20 or 22 px (`--h-ctl-s`, `--h-ctl`), the
status line 28 px. Type steps are 9 / 10 / 11 / 12 / 14 px (`--fs-xs` to
`--fs-xl`); gutters 12 and 16 px.

Tokens live in `src/app.css`: `--z-*` layers, `--tint-*` mixes,
`--focus-ring` (one global `:focus-visible` rule), `--surface-chrome`,
`--scrim`, `--shadow-pop/flyout`, `--dim-disabled`, `--dim-off`.

### 4.3 Shared primitives

| Primitive | Role |
| --- | --- |
| `Panel` | titled box, 28 px sans header, body `overflow: hidden` |
| `KV` | label / value pair; `inline` for a one-line row; tone ok / off / warn |
| `ValueField`, `SliderField` | click-to-type field; slider plus field, `lane` `scrub` (write per input) or `gesture` (one commit per gesture), inline reset, ack-hold |
| `SegmentedSelect`, `ToggleSwitch`, `MaskChips` | single choice, boolean, set membership (`aria-pressed`) |
| `NameField` | inline rename: Enter / blur commit, Esc cancel, trimmed, F2 to start |
| `ConfirmButton`, `askConfirm()` + `ConfirmModal` | tier B arm / confirm chip; tier A promise-based modal |
| `Modal`, `dismiss`, `Toaster` | true modal, dismissal action, notices |

Chips: `.chip` is the 20 px row tier (11 px sans) with tones and states
`.hi`, `.accent`, `.warn`, `.danger`, `.on`, `.armed`; `.icon-toggle` is the
22 px icon button (`.on`, `.accent`).

Recipes (`src/styles/noveau.css`, `controls.css`): `.prow` (labelled control
row, 24 px, top hairline, `.prow-lbl` 84 px, `.prow-ctl`, `.prow-fld`,
`.prow-note`), `.sec-h` (28 px section header with caption), `.kvgrid`
(two-column KV grid for system panels), text roles `.t-value`, `.t-cap`,
`.t-meta`, `.microlbl`, and `.cs-*` for CONTROL editors (`.cs-rows`, `.cs-row`,
`.cs-addrow`, `.cs-sumbtn`, `.cs-pill`, `.cs-stitle`).

## 5. Interaction idioms

### 5.1 Write lanes

| Lane | Used for | Behaviour |
| --- | --- | --- |
| Optimistic write | DSP parameters, mute, bypass, enable | UI updates at once, write queued, mirror confirms |
| Scrub | sliders (crosspoint gain, limiter threshold, preamp, modules) | a write per input event, last value wins |
| Gesture commit | EQ graph drag, `SliderField lane="gesture"`, wheel Q (150 ms trailing) | local draft while dragging, one write on release; ack-hold keeps the value until the mirror moves (1500 ms fallback) |
| Staged | hardware and I/O config (ADAT, DAC mute, output pair / PDM, UART / I2C, pins, system clock) | goes to `staging`; applied together with APPLY |
| Draft | control surfaces, IR, macros, groups, display | keyed drafts in `drafts`; SAVE writes, DISCARD rewinds |

### 5.2 Confirmation tiers

Confirmation scales with risk.

- Tier A, modal (`askConfirm`): factory reset, bootloader, firmware actions,
  deleting a slot.
- Tier B, `ConfirmButton`: EQ reset, DISCARD, AutoEQ user-entry delete, a
  disruptive APPLY.
- Tier C, none: a single parameter change and anything reversible.

### 5.3 Failure feedback

Errors raise a sticky toast and an inline message where the action lives;
other notices expire after 6 s. A degraded link shows "changes not sent" in
the status line. Preset errors reach the notice channel as well as the flyout.

### 5.4 EQ link groups

A link group is a set of channels (a stereo pair or a group the device
exposes). Groups are unlocked by default; the lock is a per-device-serial
local preference. A locked group mirrors edits from any member to the rest:
bands, crossover, input preamp, output trim and delay, reset, paste and AutoEQ
results. Locking syncs the group from the selected channel first. The toggle
is in the TUNE toolbar and peers are tinted in the rail (`*Linked` runtime
verbs).

### 5.5 Copy / paste and presets

EQ copy mode: Copy marks the source channel, any other channel shows Paste,
Exit leaves the mode. Presets copy / paste a whole-slot snapshot held in
`copySource`.

The presets editor flyout opens from the rail head name field (400 px,
intrinsic height). It holds the name (`NameField`), startup (last used / this
preset), the applicable action chips (SAVE, REVERT, COPY, PASTE, EXPORT JSON,
IMPORT JSON; EXPORT captures the live active state and leaves the clipboard
alone), the three device-wide options (master volume stored with preset,
output config stored with preset, warn on switch with unsaved changes) and a
delete picker for other occupied slots behind a ConfirmButton.

### 5.6 Selection

One source of truth per concern (`settings.selectedChannel`, `selectedBand`,
`programModule`, `setupPage`, `controlPage`). A jump sets the target selection
and the destination together: routing row or OUTPUTS anchor to a TUNE output,
INPUT EQ to TUNE, the staged reminder to the first staged SETUP page.

## 6. Enforcement

`npm run test:layout` runs `test/layout/noScroll.spec.ts` with Playwright
(Edge by default; `PW_CHANNEL` overrides). It is not part of `npm test` or the
pre-push hook because it needs a browser.

Sweeps:

- Sizes 1440 x 790 and 1600 x 880. Mock profiles at 1440 x 790: `multi`,
  `multi&chip=rp2040`, `legacy`, `multi&sysclock=fallback`; `multi` also at
  1600 x 880. A full sweep visits TUNE, the presets flyout, every PROGRAM
  module and the crosspoint popover, every SETUP page and every CONTROL page.
- Extra cases: two-device fleet, four-device rail with every output enabled,
  CONTROL at capacity with a slot editor open, CONTROL with a disruptive staged
  change and drafts, SETUP with staged changes, the docked pin map, AutoEQ
  paging.

A defect is a document taller or wider than the viewport, an element with
`overflow: auto | scroll` that scrolls, or a `[data-budget]` container (or a
shell skeleton selector) whose content exceeds its box. `data-scroll-ok`
exempts a subtree and is unused. Every container with a fixed budget carries
`data-budget`. New panels join the sweep.

## 7. Parked

### 7.1 HOME dashboard

A first-destination dashboard showing the whole device at once, every element
jumping to its editing surface. Frame: a HOME rail item above TUNE and the landing destination after connect;
workspace 1184 x 762 with no scroll; read-only except the daily toggles; click
to jump with the right thing selected; meters, clip, CPU and GR live.

Inventory: device identity and health, preset, volume and bypass, input
config, program modules, routing, per-output rows (type, pin, trim, delay,
mute, bands, limiter, GR, clip), clocks and control counts. Each jumps to its
SETUP page, PROGRAM module, TUNE channel, CONTROL page or the presets flyout.

Recommendation: a tile grid (device, response, outputs table, control strip)
with the chain drawn before and after the matrix as in PROGRAM, per-element
jumps (output row to TUNE, pill to PROGRAM module, dot to the routing
popover), a RESPONSE tile overlaying output curves (hover isolates, click
opens in TUNE), SOURCE and CLOCKS KV blocks, a clip footer, GR and clip but no
meters in the outputs table, and one preset line instead of PRESET and VOLUME
tiles. Runtime needs only existing polled data plus `wantLimiterMeter`.

A different direction is preferred and supersedes the tile grid: "The Room".
A top-down listening room where delay is distance, cabinet fill is level, each
cabinet has a limiter ring and a clip dot. The caption is prose with noun links
that jump to the surface. A day-strip footer carries history. Profiles are a
typographic line, not tiles. There is no channel rail on HOME. The mock is
built on a private design canvas first. It needs a per-output position in the
model, a telemetry ring buffer, and a last-visit stamp.

### 7.2 Other deferred items

Signal generator panel (waits for a UI direction); tube preamp module and
panel (wire V31 is read, no runtime verbs or UI); command palette (Ctrl+K);
a per-feature partial unlock or group editor for EQ link groups; CI wiring of
`test:layout`. Spacing and radius literals move to tokens file by file, not in
a sweep.

## 8. History

- 2026-10-25: three directions (A signal path, B channel strips, C focus and
  dock) reviewed against the no-scroll constraint. C kept as skeleton with
  borrowings from A and B. Floor set to 1440 x 790; no top bar; channels stay
  individual; routing edited in TUNE Sources and seen in the PROGRAM map.
- 2026-10-26: slices 1 to 4: shell and TUNE with the Playwright guard,
  PROGRAM, SETUP and split CONTROL editors, the presets flyout.
- 2026-10-27: slice 5 (rail head, preset editor, firmware-order chain, SETUP
  regroup, ABOUT), the clean cut to v2, the final audit, waves 0 to 7.

## 9. Differences from earlier plans

Where design notes and code diverged, the code is the record: the floor is
1440 x 790; the status line shows a staged count that jumps to SETUP, while
APPLY and DISCARD live in the page-strip row; SETUP has four pages and no
Diagnostics; MATRIX is still a selectable PROGRAM module beside its chain
block; Ctrl+K and the tube module do not exist.
