<script lang="ts">
  import type { Snippet } from 'svelte';

  const { title, caption, children }: { title: string; caption?: string; children: Snippet } = $props();
</script>

<section class="sec">
  <header>
    <h3>{title}</h3>
    {#if caption}<span class="cap">{caption}</span>{/if}
  </header>
  {@render children()}
</section>

<style>
  .sec { border-top: 1px solid var(--border); min-width: 0; }
  .sec:first-child { border-top: none; }
  header {
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 4px;
  }
  h3 {
    margin: 0;
    font-family: var(--font-sans);
    font-size: 12px;
    font-weight: 600;
    color: var(--text);
  }
  .cap { font-family: var(--font-sans); font-size: 11px; color: var(--text-dim); }
</style>
