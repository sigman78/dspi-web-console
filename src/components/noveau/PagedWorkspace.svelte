<script lang="ts" generics="K extends string">
  import { tick, type Snippet } from 'svelte';

  const { label, pages, page, onselect, staged, right, children }: {
    label: string;
    pages: { key: K; label: string }[];
    page: K;
    onselect: (key: K) => void;
    staged?: (key: K) => boolean;
    right?: Snippet;
    children: Snippet;
  } = $props();

  const uid = $props.id();
  let strip = $state<HTMLElement>();

  // Selection follows focus; the strip wraps at both ends.
  async function onKey(e: KeyboardEvent) {
    const idx = pages.findIndex((p) => p.key === page);
    let next: number;
    if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = pages.length - 1;
    else if (e.key === 'ArrowRight') next = (idx + 1) % pages.length;
    else if (e.key === 'ArrowLeft') next = (idx - 1 + pages.length) % pages.length;
    else return;
    e.preventDefault();
    if (next === idx) return;
    onselect(pages[next].key);
    await tick();
    strip?.querySelectorAll<HTMLElement>('[role=tab]')[next]?.focus();
  }
</script>

<div class="paged">
  <div class="toprow">
    <!-- svelte-ignore a11y_interactive_supports_focus -->
    <div class="pages" role="tablist" aria-label={label} bind:this={strip} onkeydown={onKey}>
      {#each pages as p (p.key)}
        <button
          type="button"
          class="pg"
          class:staged={staged?.(p.key)}
          role="tab"
          id="{uid}-tab-{p.key}"
          aria-selected={p.key === page}
          aria-controls="{uid}-panel"
          tabindex={p.key === page ? 0 : -1}
          onclick={() => onselect(p.key)}
        >{p.label}</button>
      {/each}
    </div>
    {@render right?.()}
  </div>

  <div class="body" id="{uid}-panel" role="tabpanel" aria-labelledby="{uid}-tab-{page}" data-budget="paged-page">{@render children()}</div>
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
  .pg:hover:not([aria-selected='true']) { color: var(--text); background: var(--wash); }
  .pg[aria-selected='true'] {
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
  .body :global(.pw-ref) { grid-column: 3; }
  .body :global(.pw-col) {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 16px;
    overflow: hidden;
  }
  .body :global(.pw-col .addrow) { padding: 3px 12px; }
  .paged :global(section.panel) {
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
    border-radius: var(--radius-m);
  }
</style>
