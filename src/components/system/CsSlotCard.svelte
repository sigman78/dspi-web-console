<script lang="ts">
  // Collapsible slot card shared by the CS binding/group/macro editors: chevron
  // + title + name (text when collapsed, input when open) + status pill + ✕.
  // Body renders only while open; the parent owns open/expanded state.
  import type { Snippet } from 'svelte';
  const {
    title, name, nameLabel, removeLabel, pill, dirty, open, disabled,
    onToggle, onRename, onRemove, summary, note, actions, children,
  }: {
    title: string;
    name: string;
    nameLabel: string;
    removeLabel: string;
    pill: { text: string; cls: string };
    dirty: boolean;
    open: boolean;
    disabled: boolean;
    onToggle: () => void;
    onRename: (name: string) => void;
    onRemove: () => void;
    summary?: Snippet;   // collapsed-header text after the name (groups: kind · members)
    note?: Snippet;      // between header and body, shown even while collapsed (macros: running step)
    actions?: Snippet;   // header buttons before ✕ (macros: FIRE/CANCEL)
    children: Snippet;
  } = $props();
</script>

<div class="slot" class:open>
  <div class="slothead">
    <button type="button" class="hdrbtn" aria-expanded={open} onclick={onToggle}>
      <span class="chev" aria-hidden="true">{open ? '▾' : '▸'}</span>
      <span class="stitle" class:staged={dirty}
        title={dirty ? 'Unapplied changes — APPLY to preview them live' : undefined}>{title}</span>
      {#if !open}
        <span class="nametext" class:faint={!name}>{name || 'Unnamed'}</span>
        {#if summary}{@render summary()}{/if}
      {/if}
    </button>
    {#if open}
      <input class="nameinput" type="text" maxlength="31" placeholder="Unnamed"
        value={name} aria-label={nameLabel} {disabled}
        onchange={(e) => onRename((e.currentTarget as HTMLInputElement).value)} />
    {/if}
    <span class="cs-pill {pill.cls}">{pill.text}</span>
    <span class="spacer"></span>
    {#if actions}{@render actions()}{/if}
    <button type="button" class="x" aria-label={removeLabel} {disabled} onclick={onRemove}>✕</button>
  </div>
  {#if note}{@render note()}{/if}
  {#if open}
    {@render children()}
  {/if}
</div>

<style>
  .slot { border-bottom: 1px solid var(--wash); }
  .slot.open {
    background: color-mix(in oklab, var(--accent) 6%, transparent);
    box-shadow: inset 2px 0 0 var(--accent);
  }
  .slothead {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 14px 0;
    font-family: var(--font-mono);
  }
  /* Collapsed: the button's overlay makes the whole padded row the toggle
     target; siblings (pill, actions, ✕) stack above it. */
  .slot:not(.open) .slothead { padding-bottom: 8px; position: relative; }
  .slot:not(.open) .hdrbtn::after { content: ''; position: absolute; inset: 0; }
  .slot:not(.open) .slothead > :global(:not(.hdrbtn)) { position: relative; }
  .slot:not(.open):hover { background: var(--wash-faint); }
  .slot.open .slothead {
    padding-bottom: 6px;
    border-bottom: 1px solid color-mix(in oklab, var(--accent) 25%, transparent);
    margin-bottom: 4px;
  }
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
  .hdrbtn:hover .stitle { color: var(--text); }
  .chev { font-size: 9px; color: var(--text-faint); width: 8px; }
  .slot.open .chev { color: var(--accent); }
  .stitle {
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 1.2px;
    color: var(--text-dim);
  }
  .slot.open .stitle { color: var(--text); }
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
  .nameinput {
    font-family: var(--font-mono);
    font-size: 10px;
    padding: 2px 6px;
    width: 130px;
    background: var(--panel-solid);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 4px;
  }
  .nameinput:disabled { opacity: var(--dim-disabled); }
  .spacer { flex: 1; }
  .x {
    background: none;
    border: none;
    color: var(--text-faint);
    cursor: pointer;
    padding: 0;
    font-size: 9px;
    line-height: 1;
  }
  .x:hover:not(:disabled) { color: var(--err); }
  .x:disabled { opacity: var(--dim-disabled); cursor: default; }
</style>
