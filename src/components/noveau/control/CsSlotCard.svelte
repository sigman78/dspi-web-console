<script lang="ts">
  // Collapsible slot card shared by the CS binding/group/macro editors: chevron
  // + title + name text (pencil when open requests a rename) + status pill + ✕.
  // Body renders only while open; the parent owns open/expanded state.
  import type { Snippet } from 'svelte';
  import { portal } from '@/components/chrome/portal';
  const {
    title, name, nameLabel, removeLabel, pill, dirty, live, open, disabled,
    onToggle, onRenameRequest, onRemove, summary, rename, note, actions, children, detailTarget = null,
  }: {
    title: string;
    name: string;
    nameLabel: string;
    removeLabel: string;
    pill: { text: string; cls: string };
    dirty: boolean;
    live: boolean;       // applied on the device; the dirty dot only marks edits to live slots
    open: boolean;
    disabled: boolean;
    onToggle: () => void;
    onRenameRequest: () => void;
    onRemove: () => void;
    summary?: Snippet;   // collapsed-header text after the name (groups: kind · members)
    rename?: Snippet;    // anchored name popover, shown under the header
    note?: Snippet;      // between header and body, shown even while collapsed (macros: running step)
    actions?: Snippet;   // header buttons before ✕ (macros: FIRE/CANCEL)
    children: Snippet;
    detailTarget?: HTMLElement | null; // split layout: the open body renders here instead of inline
  } = $props();
</script>

<div class="slot" class:open>
  <div class="slothead">
    <button type="button" class="hdrbtn" aria-expanded={open} onclick={onToggle}>
      <span class="chev" aria-hidden="true">{open ? '▾' : '▸'}</span>
      <span class="cs-stitle" class:draft={dirty && live}
        title={dirty && live ? 'Unapplied changes — APPLY to preview them live' : undefined}>{title}</span>
      <span class="nametext" class:faint={!name}>{name || 'Unnamed'}</span>
      {#if !open && summary}{@render summary()}{/if}
    </button>
    {#if open}
      <button type="button" class="x-btn" aria-label={nameLabel} {disabled} onclick={onRenameRequest}>✎</button>
    {/if}
    <span class="cs-pill {pill.cls}">{pill.text}</span>
    <span class="cs-spacer"></span>
    {#if actions}{@render actions()}{/if}
    <button type="button" class="x-btn" aria-label={removeLabel} {disabled} onclick={onRemove}>✕</button>
  </div>
  {#if rename}<div class="renamehost">{@render rename()}</div>{/if}
  {#if note}{@render note()}{/if}
  {#if open}
    {#if detailTarget}
      <div class="detail" use:portal={detailTarget}>
        {@render children()}
      </div>
    {:else}
      {@render children()}
    {/if}
  {/if}
</div>

<style>
  .slot { position: relative; border-bottom: 1px solid var(--wash); }
  .renamehost { position: absolute; top: var(--h-row); left: 0; right: 0; height: 0; }
  .slot.open {
    background: color-mix(in oklab, var(--accent) var(--tint-weak), transparent);
    box-shadow: inset 3px 0 0 var(--accent);
  }
  .slothead {
    display: flex;
    align-items: center;
    gap: 8px;
    box-sizing: border-box;
    height: var(--h-row);
    padding: 0 14px;
    font-family: var(--font-mono);
  }
  /* Collapsed: the button's overlay makes the whole padded row the toggle
     target; siblings (pill, actions, ✕) stack above it. */
  .slot:not(.open) .slothead { position: relative; }
  .slot:not(.open) .hdrbtn::after { content: ''; position: absolute; inset: 0; }
  .slot:not(.open) .slothead > :global(:not(.hdrbtn)) { position: relative; }
  .slot:not(.open):hover { background: var(--wash-faint); }
  .slot.open .slothead { margin-bottom: 4px; }
  .hdrbtn {
    display: flex;
    align-items: center;
    gap: 8px;
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    color: inherit;
    font: inherit;
    text-align: left;
    min-width: 0;
  }
  .hdrbtn:hover .cs-stitle { color: var(--text); }
  .chev { font-size: 9px; color: var(--text-faint); width: 8px; }
  .slot.open .chev { color: var(--accent); }
  .slot.open .cs-stitle { color: var(--text); }
  .nametext {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 160px;
  }
  .nametext.faint { color: var(--text-faint); }
</style>
