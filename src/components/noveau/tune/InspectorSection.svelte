<script lang="ts">
  import type { Snippet } from 'svelte';

  const { title, caption, children }: { title: string; caption?: string; children: Snippet } = $props();
</script>

<section class="sec">
  <header class="sec-h">
    <h3>{title}</h3>
    {#if caption}<span class="cap">{caption}</span>{/if}
  </header>
  {@render children()}
</section>

<style>
  .sec { border-top: 1px solid var(--border); min-width: 0; }
  .sec:first-child { border-top: none; }
  .cap { flex: 0 1 auto; margin-left: auto; }
</style>
