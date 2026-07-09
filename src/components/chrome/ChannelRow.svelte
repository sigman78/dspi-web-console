<script module lang="ts">
  import { SvelteMap } from 'svelte/reactivity';
  import type { ChannelId } from '@/domain';

  // Discrete LED VU scale: fixed-colour segments (deep→bright green, then amber,
  // then coral red). The segment DOM is static; which LEDs are lit is driven by
  // the track's --vu-lit / --vu-peak custom properties (see the .seg CSS).
  const VU_SEGMENTS = 12;
  const AMBER_AT = 0.72; // fraction where the amber band starts
  const RED_AT = 0.9;    // fraction where the red band starts

  const VU_COLORS = Array.from({ length: VU_SEGMENTS }, (_, i) => {
    const mid = (i + 0.5) / VU_SEGMENTS;
    if (mid >= RED_AT) return 'var(--err)';
    if (mid >= AMBER_AT) return 'var(--warn)';
    // Deep→bright green ramp across the green band (discrete per segment).
    const f = mid / AMBER_AT;
    return `oklch(${(56 + 24 * f).toFixed(1)}% ${(0.13 + 0.06 * f).toFixed(3)} 150)`;
  });

  // First LED of the red band -- only a held peak that reaches here lingers.
  const RED_SEG_FROM = VU_COLORS.findIndex((c) => c === 'var(--err)');

  // Red-peak hold, shared across every meter on the rail. While a channel's
  // level sits in the red band its held segment + expiry is refreshed here; once
  // it leaves the band the entry counts down and a SINGLE shared timeout — armed
  // for the nearest expiry — sweeps it out. Reactive (SvelteMap) so each row's
  // marker derives straight off its own entry with no per-row setTimeout.
  const RED_HOLD_MS = 1000;
  const redHolds = new SvelteMap<ChannelId, { seg: number; until: number }>();
  let sweepTimer = 0;

  function sweepRedHolds(): void {
    clearTimeout(sweepTimer);
    sweepTimer = 0;
    const now = performance.now();
    let next = Infinity;
    for (const [id, hold] of redHolds) {
      if (hold.until <= now) redHolds.delete(id);
      else next = Math.min(next, hold.until);
    }
    if (next < Infinity) sweepTimer = window.setTimeout(sweepRedHolds, next - now);
  }

  // Refresh a channel's red hold to the running-max segment and a fresh expiry.
  function armRedHold(id: ChannelId, seg: number): void {
    redHolds.set(id, { seg, until: performance.now() + RED_HOLD_MS });
    if (!sweepTimer) sweepRedHolds();
  }

  function releaseRedHold(id: ChannelId): void {
    if (redHolds.delete(id)) sweepRedHolds();
  }
</script>

<script lang="ts">
  import { untrack } from 'svelte';
  import { chKey } from '@/styles/palette';
  import { CHANNEL_NAME_MAX_LEN } from '@/domain';

  const {
    name,
    channelId,
    levelDb,
    defaultName,
    selected = false,
    dim = false,
    pulsate = false,
    disabled = false,
    editing = false,
    onclick,
    onStartEdit,
    onCommitName,
    onCancelEdit,
  }: {
    name: string;
    channelId: ChannelId;
    levelDb: number;
    defaultName: string;
    selected?: boolean;
    dim?: boolean;
    pulsate?: boolean;
    disabled?: boolean;
    editing?: boolean;
    onclick?: () => void;
    onStartEdit?: () => void;
    onCommitName?: (name: string) => void;
    onCancelEdit?: () => void;
  } = $props();

  const pct = $derived(Math.max(0, Math.min(1, (levelDb + 60) / 60)));

  // Fill height as an LED count (0..VU_SEGMENTS); the whole hot path is this one
  // number pushed to a --vu-lit custom property, so a tick tweaks a single
  // attribute rather than re-toggling a class on all 12 segment nodes.
  const litCount = $derived(Math.max(0, Math.min(VU_SEGMENTS, Math.ceil(pct * VU_SEGMENTS))));

  // While the live level is in the red band, keep this channel's shared hold
  // refreshed to the running-max red segment; the module timer clears it once
  // the level drops out and the hold window lapses. Depends only on pct (the
  // map read/write is untracked), so arming can't re-trigger this effect.
  $effect(() => {
    const top = litCount - 1;
    if (top >= RED_SEG_FROM) {
      const id = channelId;
      untrack(() => armRedHold(id, Math.max(top, redHolds.get(id)?.seg ?? -1)));
    }
  });
  $effect(() => () => releaseRedHold(channelId));

  // The held red LED, exposed only while it floats ABOVE the current fill (once
  // the level recedes past it); -1 otherwise, so no marker while it rides the top
  // of the fill or after the hold clears. SvelteMap keys track per-channel, so
  // this recomputes only when THIS row's hold changes.
  const heldSeg = $derived(redHolds.get(channelId)?.seg ?? -1);
  const peakOut = $derived(heldSeg >= litCount ? heldSeg : -1);

  let selectBtn = $state<HTMLButtonElement>();

  // Each edit session ends with exactly one terminal callback. Enter/Escape and
  // the blur that follows the input's unmount would otherwise both fire; this
  // flag (re-armed in initInput on mount) makes the trailing event a no-op.
  let committed = false;
  // Return focus to the select button only on a keyboard exit (Enter/Escape) —
  // a click-away blur should leave focus where the user clicked.
  let restoreFocus = false;

  let wasEditing = false;
  $effect(() => {
    if (!editing && wasEditing && restoreFocus) {
      selectBtn?.focus();
      restoreFocus = false;
    }
    wasEditing = editing;
  });

  function handleClick() {
    if (!disabled) onclick?.();
  }

  function startEdit() {
    if (disabled) return;
    // Clear the native word-selection a double-click leaves on the label so it
    // doesn't collide with the input's select-all-on-mount.
    window.getSelection()?.removeAllRanges();
    onStartEdit?.();
  }

  // The editor input is uncontrolled: seeded once on mount, then read straight
  // from the DOM on commit. With no reactive binding, the rail's telemetry-driven
  // re-renders can't clobber in-progress typing.
  function initInput(node: HTMLInputElement) {
    committed = false;
    node.value = name;
    node.focus();
    node.select();
  }

  function commitOnce(node: HTMLInputElement) {
    if (committed) return;
    committed = true;
    onCommitName?.(node.value);
  }

  function onInputKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      restoreFocus = true;
      commitOnce(e.currentTarget as HTMLInputElement);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      committed = true; // swallow the unmount blur that follows
      restoreFocus = true;
      onCancelEdit?.();
    }
  }

  function onInputBlur(e: FocusEvent) {
    commitOnce(e.currentTarget as HTMLInputElement);
  }
</script>

{#snippet meter()}
  <!-- Static segment DOM: each LED's colour and index are set once. A tick only
       rewrites --vu-lit (fill height) and --vu-peak (held red LED) on the track;
       CSS lights each segment from those two numbers. -->
  <span class="track" aria-hidden="true" style:--vu-lit={litCount} style:--vu-peak={peakOut}>
    {#each VU_COLORS as color, i (i)}
      <span class="seg" style:--seg-c={color} style:--vu-i={i}></span>
    {/each}
  </span>
{/snippet}

<div
  class="row ch-{chKey(channelId)}"
  class:selected
  class:dim
  class:pulsate
  class:editing
  class:is-disabled={disabled}
>
  {#if editing}
    <input
      class="nm-input"
      type="text"
      use:initInput
      maxlength={CHANNEL_NAME_MAX_LEN}
      placeholder={defaultName}
      spellcheck="false"
      autocomplete="off"
      aria-label={`Rename ${name}`}
      onkeydown={onInputKeydown}
      onblur={onInputBlur}
    />
    {@render meter()}
  {:else}
    <!-- The whole row body is the select target (click → select, double-click →
         rename), so the meter area stays clickable. The editor input can't live
         inside a <button>, so it replaces this body when editing. -->
    <button
      class="body"
      bind:this={selectBtn}
      {disabled}
      aria-pressed={selected}
      title={name}
      onclick={handleClick}
      ondblclick={startEdit}
    >
      <span class="nm">{name}</span>
      {@render meter()}
    </button>
  {/if}
</div>

<style>
  .row {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 100%;
    /* Padding lives on the inner .body button (idle) and on the row itself only
       while editing, so the clickable select target has no dead ring around it. */
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 4px;
    /* Per-channel button fill: the channel's own hue tints a left-anchored
       gradient (base at the left edge, fading right so it reads off the coloured
       spine beside it) over the neutral wash, plus a soft inset glow bleeding in
       from that same edge -- the TabBar active-tab treatment, per channel. */
    background:
      linear-gradient(to right,
        color-mix(in oklab, var(--ch-base) 20%, transparent),
        color-mix(in oklab, var(--ch-base) 6%, transparent) 45%,
        transparent 85%),
      var(--wash);
    box-shadow: inset 12px 0 20px -14px color-mix(in oklab, var(--ch-glow) 45%, transparent);
    color: var(--text);
    font-family: var(--font-mono);
    text-align: left;
    cursor: pointer;
    transition: background 100ms, border-color 100ms, box-shadow 100ms;
  }
  /* Keep content above the hatch overlay (::before, see below). */
  .row > * { position: relative; z-index: 1; }
  .row:hover:not(.is-disabled):not(.selected) {
    border-color: var(--border-hi);
    background:
      linear-gradient(to right,
        color-mix(in oklab, var(--ch-base) 30%, transparent),
        color-mix(in oklab, var(--ch-base) 10%, transparent) 45%,
        transparent 85%),
      var(--wash-strong);
  }
  .row.is-disabled { cursor: default; }
  /* Editing swaps the .body button for bare input/track children, so the row
     supplies the padding the .body otherwise would. */
  .row.editing { padding: 5px 7px; }
  /* The clickable row body: a button so the whole row (name + meter) selects.
     Resets to inherit the row's box; lays its contents out like the row did. */
  .body {
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 100%;
    background: none;
    border: none;
    padding: 5px 7px;
    margin: 0;
    text-align: left;
    color: inherit;
    font-family: inherit;
    cursor: inherit;
  }
  /* U-P3 policy B: the rail around this stays full-contrast when disconnected
     (see ChannelRail's .rail-body.is-disabled); this is the single dim layer
     on the control itself. */
  .body:disabled { opacity: var(--dim-disabled); cursor: default; }
  .nm {
    font-size: 10px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  /* Inline editor. A solid --bg backdrop keeps the text legible on a selected
     row (accent fill) or a dim row, instead of inheriting either. */
  .nm-input {
    display: block;
    width: 100%;
    box-sizing: border-box;
    color: var(--text);
    background: var(--bg);
    border: none;
    border-radius: 2px;
    padding: 0 2px;
    margin: 0;
    font-family: inherit;
    font-size: 10px;
    outline: none;
    box-shadow: inset 0 0 0 1px var(--accent);
  }
  /* Discrete LED meter: a row of fixed-width segments in a dark bezel. The dark
     track bg shows through the 1px gaps and the 1px pad as the frame, so the
     meter reads the same on any row background (incl. a selected accent fill). */
  .track {
    display: flex;
    gap: 1px;
    height: 6px;
    padding: 1px;
    border-radius: 2px;
    background: oklch(0% 0 0 / 0.5);
  }
  /* Each LED is flat -- no bevel/outline. Lit/off and the peak glow are derived
     purely from the track's two numbers (--vu-lit fill height, --vu-peak held
     LED) against this segment's own index (--vu-i): --on is 1 when this LED sits
     below the fill, --is-peak is 1 only on the held red LED. The 1px gaps + dark
     track bezel are the sole separators, so the row reads the same on any bg. */
  .seg {
    flex: 1 1 0;
    min-width: 0;
    border-radius: 1px;
    --on: clamp(0, calc(var(--vu-lit) - var(--vu-i)), 1);
    --is-peak: clamp(0, calc(1 - abs(var(--vu-i) - var(--vu-peak))), 1);
    --show: max(var(--on), var(--is-peak));
    background-color: color-mix(in oklab,
      var(--seg-c) calc(var(--show) * 100%),
      color-mix(in oklab, var(--text) 9%, transparent));
    /* Held peak LED lifts with an outer glow; zero-width/transparent otherwise. */
    box-shadow: 0 0 calc(var(--is-peak) * 5px)
      color-mix(in oklab, var(--seg-c) calc(var(--is-peak) * 100%), transparent);
    transition: background-color 45ms linear;
  }

  /* Selected: the channel's hue fills the button; text flips to bg contrast.
     Drop the idle inner glow -- the solid fill already carries the colour. */
  .row.selected {
    background: var(--ch-base);
    border-color: var(--ch-base);
    box-shadow: none;
  }
  /* Hover on the selected row brightens the accent rather than letting the
     generic hover paint a dark bg under the (dark) selected text. */
  .row.selected:hover:not(.is-disabled) {
    background: color-mix(in oklab, var(--ch-base) 85%, var(--text));
    border-color: color-mix(in oklab, var(--ch-base) 85%, var(--text));
  }
  .row.selected .nm { color: var(--bg); font-weight: 600; }

  /* Disabled/unused channels get a diagonal hatch (carried over from the old
     MiniPin look). It lives on a ::before overlay so it can fade in/out — a
     gradient painted on `background` can't be transitioned. On the dark
     unselected row the stripes are light; on the light accent fill of a
     selected channel they flip dark so the hatch still reads — a
     selected-but-disabled channel stays visibly disabled. */
  .row::before {
    content: "";
    position: absolute;
    inset: 0;
    z-index: 0;
    border-radius: inherit;
    pointer-events: none;
    opacity: 0;
    background: repeating-linear-gradient(
      135deg,
      color-mix(in oklab, var(--text) 16%, transparent) 0 2px,
      transparent 2px 6px
    );
    transition: opacity 120ms ease;
  }
  .row.dim::before { opacity: 1; }
  /* While editing, drop the hatch so the input reads cleanly on a dim row. */
  .row.editing::before { opacity: 0; }
  /* Off/unused channels: flatten to a faint neutral wash and kill the glow --
     the colour cue belongs to live channels. */
  .row.dim { box-shadow: none; }
  .row.dim:not(.selected) {
    background: var(--wash-faint);
  }
  .row.dim.selected::before {
    background: repeating-linear-gradient(
      135deg,
      color-mix(in oklab, var(--bg) 45%, transparent) 0 2px,
      transparent 2px 6px
    );
  }
  /* U-P3 policy B: the row stays clickable/selectable even when it maps to
     an off output, so this isn't a disabled region -- no opacity on the
     name label. The hatch overlay above is the sole "off" signal. */
  .row.pulsate { animation: row-pulse 2s ease-in-out infinite; }
  @keyframes row-pulse {
    0%, 100% { background: var(--wash); }
    50%      { background: color-mix(in oklab, var(--ch-base) 45%, transparent); }
  }
  @media (prefers-reduced-motion: reduce) {
    .row.pulsate { animation: none; background: color-mix(in oklab, var(--ch-base) 35%, transparent); }
    .row::before { transition: none; }
  }
</style>
