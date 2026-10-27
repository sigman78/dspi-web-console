<script lang="ts" generics="K extends string">
  import type { Snippet } from 'svelte';

  const { label, pages, page, onselect, staged, right, children }: {
    label: string;
    pages: { key: K; label: string }[];
    page: K;
    onselect: (key: K) => void;
    staged?: (key: K) => boolean;
    right?: Snippet;
    children: Snippet;
  } = $props();
</script>

<div class="paged">
  <div class="toprow">
    <div class="pages" role="group" aria-label={label}>
      {#each pages as p (p.key)}
        <button
          type="button"
          class="pg"
          class:staged={staged?.(p.key)}
          aria-pressed={p.key === page}
          onclick={() => onselect(p.key)}
        >{p.label}</button>
      {/each}
    </div>
    {@render right?.()}
  </div>

  <div class="body" data-budget="paged-page">{@render children()}</div>
</div>

<style>
  .paged {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: grid;
    grid-template-rows: 28px minmax(0, 1fr);
    row-gap: 12px;
    overflow: hidden;
  }
  .toprow {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    min-width: 0;
  }
  .pages {
    display: flex;
    align-items: stretch;
    height: 28px;
    width: max-content;
    border: 1px solid var(--border);
    border-radius: var(--radius-m);
    overflow: hidden;
    background: var(--wash-faint);
  }
  .pg {
    font-family: var(--font-sans);
    font-size: 11px;
    letter-spacing: 0.5px;
    font-weight: 600;
    padding: 0 16px;
    background: transparent;
    border: none;
    border-right: 1px solid var(--border);
    color: var(--text-dim);
    cursor: pointer;
    white-space: nowrap;
  }
  .pg:last-child { border-right: none; }
  .pg.staged::after { top: 6px; right: 6px; }
  .pg:hover:not([aria-pressed='true']) { color: var(--text); background: var(--wash); }
  .pg[aria-pressed='true'] {
    color: var(--text);
    background: color-mix(in oklab, var(--accent) var(--tint), transparent);
  }
  .body {
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }
  /* Slotted markup belongs to the view, so these reach it through :global. */
  .body :global(.pw-cols) {
    min-width: 0;
    min-height: 0;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 16px;
    align-items: start;
    overflow: hidden;
  }
  .body :global(.pw-cols[hidden]) { display: none; }
  .body :global(.pw-col) {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 16px;
    overflow: hidden;
  }
  .body :global(.pw-col .addrow) { padding: 3px 12px; }
  /* Read-only reference material (pin map): flat, dashed, tagged, so it
     does not read as another configuration panel. */
  .body :global(.pw-ref .panel) {
    background: transparent;
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
    border-style: dashed;
    border-color: var(--border);
  }
  .body :global(.pw-ref .panel > header) { background: transparent; }
  .body :global(.pw-ref .panel > header .title) { color: var(--text-dim); }
  .body :global(.pw-ref .panel > header .title)::after {
    content: 'REFERENCE';
    margin-left: 8px;
    padding: 0 6px;
    border-radius: var(--radius-s);
    font-family: var(--font-mono);
    font-size: var(--fs-m);
    font-weight: 500;
    letter-spacing: 0.04em;
    color: var(--text-faint);
    background: var(--wash);
  }

  .paged :global(section.panel) {
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
    border-radius: var(--radius-m);
  }
</style>
