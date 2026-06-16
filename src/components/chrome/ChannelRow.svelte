<script lang="ts">
  import { chKey } from '@/styles/palette';
  import { CHANNEL_NAME_MAX_LEN, type ChannelId } from '@/domain';

  const {
    name,
    channelId,
    levelDb,
    defaultName,
    selected = false,
    dim = false,
    pulsate = false,
    clipped = false,
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
    clipped?: boolean;
    disabled?: boolean;
    editing?: boolean;
    onclick?: () => void;
    onStartEdit?: () => void;
    onCommitName?: (name: string) => void;
    onCancelEdit?: () => void;
  } = $props();

  const pct = $derived(Math.max(0, Math.min(1, (levelDb + 60) / 60)));
  const warm = $derived(pct > 0.75 && pct <= 0.92);
  const hot = $derived(pct > 0.92);

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
    <span class="track">
      <span class="fill" class:warm class:hot style:width="{pct * 100}%"></span>
    </span>
    <span class="clipline" class:on={clipped}></span>
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
      <span class="track">
        <span class="fill" class:warm class:hot style:width="{pct * 100}%"></span>
      </span>
      <span class="clipline" class:on={clipped}></span>
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
    padding: 5px 7px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: color-mix(in oklab, var(--text) 3%, transparent);
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
    background: color-mix(in oklab, var(--text) 7%, transparent);
  }
  .row.is-disabled { cursor: default; }
  /* The clickable row body: a button so the whole row (name + meter) selects.
     Resets to inherit the row's box; lays its contents out like the row did. */
  .body {
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 100%;
    background: none;
    border: none;
    padding: 0;
    margin: 0;
    text-align: left;
    color: inherit;
    font-family: inherit;
    cursor: inherit;
  }
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
  .track {
    height: 4px;
    background: color-mix(in oklab, var(--text) 12%, transparent);
    border-radius: 2px;
    overflow: hidden;
  }
  .fill {
    display: block;
    height: 100%;
    background: var(--ch-bright);
    border-radius: 2px;
    transition: width 80ms linear;
  }
  .fill.warm { background: var(--warn); }
  .fill.hot { background: var(--err); }

  /* Selected: the channel's hue fills the button; text flips to bg contrast. */
  .row.selected {
    background: var(--ch-base);
    border-color: var(--ch-base);
  }
  /* Hover on the selected row brightens the accent rather than letting the
     generic hover paint a dark bg under the (dark) selected text. */
  .row.selected:hover:not(.is-disabled) {
    background: color-mix(in oklab, var(--ch-base) 85%, var(--text));
    border-color: color-mix(in oklab, var(--ch-base) 85%, var(--text));
  }
  .row.selected .nm { color: var(--bg); font-weight: 600; }
  .row.selected .track { background: color-mix(in oklab, var(--bg) 22%, transparent); }
  .row.selected .fill { background: var(--bg); }
  .row.selected .fill.warm { background: var(--warn); }
  .row.selected .fill.hot { background: var(--err); }

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
  .row.dim:not(.selected) {
    background: color-mix(in oklab, var(--text) 2%, transparent);
  }
  .row.dim.selected::before {
    background: repeating-linear-gradient(
      135deg,
      color-mix(in oklab, var(--bg) 45%, transparent) 0 2px,
      transparent 2px 6px
    );
  }
  .row.dim .nm { opacity: 0.55; }
  .row.pulsate { animation: row-pulse 2s ease-in-out infinite; }
  @keyframes row-pulse {
    0%, 100% { background: color-mix(in oklab, var(--text) 3%, transparent); }
    50%      { background: color-mix(in oklab, var(--ch-base) 45%, transparent); }
  }
  @media (prefers-reduced-motion: reduce) {
    .row.pulsate { animation: none; background: color-mix(in oklab, var(--ch-base) 35%, transparent); }
    .row::before { transition: none; }
  }

  /* Latched clip indicator: 1px red underline, always present to avoid reflow. */
  .clipline {
    height: 1px;
    background: transparent;
    border-radius: 1px;
    pointer-events: none;
  }
  .clipline.on { background: #ff0000; }
</style>
