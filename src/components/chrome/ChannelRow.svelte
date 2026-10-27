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

  // Red-peak hold, shared across every meter on the rail. An active entry has no
  // expiry; leaving the red band starts its hold window. One timeout, armed for
  // the nearest released entry, sweeps expired holds for the entire rail.
  const RED_HOLD_MS = 1000;
  const redHolds = new SvelteMap<ChannelId, { seg: number; until: number | null }>();
  let sweepTimer = 0;

  function sweepRedHolds(): void {
    clearTimeout(sweepTimer);
    sweepTimer = 0;
    const now = performance.now();
    let next = Infinity;
    for (const [id, hold] of redHolds) {
      if (hold.until === null) continue;
      if (hold.until <= now) redHolds.delete(id);
      else next = Math.min(next, hold.until);
    }
    if (next < Infinity) sweepTimer = window.setTimeout(sweepRedHolds, next - now);
  }

  function updateRedHold(id: ChannelId, seg: number): void {
    const hold = redHolds.get(id);
    if (seg >= RED_SEG_FROM) {
      if (!hold || seg > hold.seg) redHolds.set(id, { seg, until: null });
      else hold.until = null;
    } else if (hold?.until === null) {
      // Mutating the non-rendered expiry avoids invalidating map subscribers.
      hold.until = performance.now() + RED_HOLD_MS;
      if (!sweepTimer) sweepRedHolds();
    }
  }

  function releaseRedHold(id: ChannelId): void {
    if (redHolds.delete(id)) sweepRedHolds();
  }
</script>

<script lang="ts">
  import { untrack } from 'svelte';
  import { chKey } from '@/styles/palette';
  import { CHANNEL_NAME_MAX_LEN } from '@/domain';
  import NameField from '@/components/chrome/NameField.svelte';

  const {
    name,
    channelId,
    levelDb,
    defaultName,
    selected = false,
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

  // This effect follows quantized LED transitions, not every telemetry sample.
  // Map access is untracked so a held-marker update cannot re-trigger it.
  $effect(() => {
    const top = litCount - 1;
    const id = channelId;
    untrack(() => updateRedHold(id, top));
  });
  $effect(() => () => releaseRedHold(channelId));

  // The held red LED, exposed only while it floats ABOVE the current fill (once
  // the level recedes past it); -1 otherwise, so no marker while it rides the top
  // of the fill or after the hold clears. SvelteMap keys track per-channel, so
  // this recomputes only when THIS row's hold changes.
  const heldSeg = $derived(redHolds.get(channelId)?.seg ?? -1);
  const peakOut = $derived(heldSeg >= litCount ? heldSeg : -1);

  let selectBtn = $state<HTMLButtonElement>();

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

  // F2 renames from the keyboard; Enter does too once the row is already
  // selected (Enter on an unselected row stays "select").
  function onKeydown(e: KeyboardEvent) {
    if (disabled || editing || e.defaultPrevented) return;
    if (e.key === 'F2' || (e.key === 'Enter' && selected)) {
      e.preventDefault();
      startEdit();
    }
  }

  function startEdit() {
    if (disabled) return;
    // Clear the native word-selection a double-click leaves on the label so it
    // doesn't collide with the input's select-all-on-mount.
    window.getSelection()?.removeAllRanges();
    onStartEdit?.();
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
  class:pulsate
  class:editing
  class:is-disabled={disabled}
>
  {#if editing}
    <NameField
      class="nm-input"
      editing
      allowEmpty
      value={name}
      maxlength={CHANNEL_NAME_MAX_LEN}
      placeholder={defaultName}
      ariaLabel={`Rename ${name}`}
      onCommit={(v) => onCommitName?.(v)}
      onCancel={() => onCancelEdit?.()}
      onKeyExit={() => { restoreFocus = true; }}
    />
    {@render meter()}
  {:else}
    <!-- The whole row body is the select target (click → select, double-click →
         rename), so the meter area stays clickable. Only the .ch-face carries the
         button chrome; the meter sits below it, outside the visible face. The
         editor input can't live inside a <button>, so it replaces this body
         when editing. -->
    <button
      class="body"
      bind:this={selectBtn}
      {disabled}
      aria-pressed={selected}
      title={name}
      onclick={handleClick}
      ondblclick={startEdit}
      onkeydown={onKeydown}
    >
      <span class="ch-face"><span class="nm">{name}</span></span>
      {@render meter()}
    </button>
  {/if}
</div>

<style>
  .row {
    position: relative;
    display: flex;
    flex-direction: column;
    /* Tight enough that the meter reads as this chip's, not the next row's. */
    gap: 1px;
    width: 100%;
    padding: 0;
    color: var(--text);
    font-family: var(--font-mono);
    text-align: left;
  }
  /* The clickable row body: a button so the whole row (chip + meter) selects.
     Bare of chrome -- the visible face is the .ch-face inside it. */
  .body {
    display: flex;
    flex-direction: column;
    gap: 1px;
    width: 100%;
    background: none;
    border: none;
    padding: 0;
    margin: 0;
    text-align: left;
    color: inherit;
    font-family: inherit;
    cursor: pointer;
  }
  /* The visible button face: name only; the meter lives below it. 20px chip +
     1px gap + 6px meter. */
  .ch-face {
    display: flex;
    align-items: center;
    height: 20px;
    padding: 0 7px;
    border: 1px solid var(--border);
    border-radius: var(--radius-s);
    /* Per-channel button fill: the channel's own hue tints a left-anchored
       gradient (base at the left edge, fading right so it reads off the coloured
       spine beside it) over the neutral wash, plus a soft inset glow bleeding in
       from that same edge -- the active-item treatment, per channel. */
    background:
      linear-gradient(to right,
        color-mix(in oklab, var(--ch-base) 20%, transparent),
        color-mix(in oklab, var(--ch-base) 6%, transparent) 45%,
        transparent 85%),
      var(--wash);
    box-shadow: inset 12px 0 20px -14px color-mix(in oklab, var(--ch-glow) 45%, transparent);
    transition: background 100ms, border-color 100ms, box-shadow 100ms;
  }
  .row:not(.selected) .body:hover:not(:disabled) .ch-face {
    border-color: var(--border-hi);
    background:
      linear-gradient(to right,
        color-mix(in oklab, var(--ch-base) 30%, transparent),
        color-mix(in oklab, var(--ch-base) 10%, transparent) 45%,
        transparent 85%),
      var(--wash-strong);
  }
  /* U-P3 policy B: the rail around this stays full-contrast when disconnected
     (see ChannelList's .rail-body.is-disabled); this is the single dim layer
     on the control itself. */
  .body:disabled { opacity: var(--dim-disabled); cursor: default; }
  .nm {
    font-family: var(--font-sans);
    font-size: 11px;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  /* Inline editor: replaces the .ch-face, so it takes the chip's height. A solid
     --bg backdrop keeps the text legible on a selected row (accent fill)
     instead of inheriting it. */
  .row :global(.nm-input) {
    display: block;
    width: 100%;
    box-sizing: border-box;
    color: var(--text);
    background: var(--bg);
    border: none;
    border-radius: var(--radius-s);
    height: 20px;
    padding: 0 8px;
    margin: 0;
    font-family: var(--font-sans);
    font-size: 11px;
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
    border-radius: var(--radius-xs);
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
      var(--wash-strong));
    /* Held peak LED lifts with an outer glow; zero-width/transparent otherwise. */
    box-shadow: 0 0 calc(var(--is-peak) * 5px)
      color-mix(in oklab, var(--seg-c) calc(var(--is-peak) * 100%), transparent);
    transition: background-color 45ms linear;
  }

  /* Selected: the channel's hue fills the button face; text flips to bg
     contrast. Drop the idle inner glow -- the solid fill already carries the
     colour. */
  .row.selected .ch-face {
    background: var(--ch-base);
    border-color: var(--ch-base);
    box-shadow: none;
  }
  /* Hover on the selected row brightens the accent rather than letting the
     generic hover paint a dark bg under the (dark) selected text. */
  .row.selected .body:hover:not(:disabled) .ch-face {
    background: color-mix(in oklab, var(--ch-base) 85%, var(--text));
    border-color: color-mix(in oklab, var(--ch-base) 85%, var(--text));
  }
  .row.selected .nm { color: var(--bg); font-weight: 600; }

  .row.pulsate .ch-face { animation: row-pulse 2s ease-in-out infinite; }
  @keyframes row-pulse {
    0%, 100% { background: var(--wash); }
    50%      { background: color-mix(in oklab, var(--ch-base) 45%, transparent); }
  }
  @media (prefers-reduced-motion: reduce) {
    .row.pulsate .ch-face { animation: none; background: color-mix(in oklab, var(--ch-base) 35%, transparent); }
  }
</style>
