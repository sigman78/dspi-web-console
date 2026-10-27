<script lang="ts">
  import type { Snippet } from 'svelte';

  const {
    title,
    right,
    children,
  }: {
    title: string;
    right?: Snippet;
    children: Snippet;
  } = $props();
</script>

<section class="panel">
  <header>
    <span class="title">{title}</span>
    <span class="right">{#if right}{@render right()}{/if}</span>
  </header>
  <div class="body">
    {@render children()}
  </div>
</section>

<style>
  .panel {
    background: var(--panel);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  header {
    height: var(--h-head);
    flex: none;
    padding: 0 12px;
    display: flex;
    align-items: center;
    gap: 10px;
    border-bottom: 1px solid var(--border);
  }
  .title {
    font-family: var(--font-sans);
    font-size: var(--fs-m);
    color: var(--text);
    font-weight: 600;
    flex: 1;
  }
  .right { display: flex; align-items: center; gap: 6px; }
  .body { flex: 1; min-height: 0; overflow: hidden; }
</style>
