<script lang="ts">
  import type { Snippet } from 'svelte';

  const {
    code,
    title,
    right,
    children,
  }: {
    code?: string;
    title: string;
    right?: Snippet;
    children: Snippet;
  } = $props();
</script>

<section class="panel">
  <header>
    {#if code}<span class="code">{code}</span>{/if}
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
    padding: 10px 14px;
    display: flex;
    align-items: center;
    gap: 10px;
    border-bottom: 1px solid var(--border);
    font-family: var(--font-mono);
  }
  .code {
    font-size: 9px;
    color: var(--text-faint);
    letter-spacing: 1px;
  }
  .title {
    font-size: 10px;
    color: var(--text);
    letter-spacing: 1.5px;
    font-weight: 600;
    text-transform: uppercase;
    flex: 1;
  }
  .right { display: flex; align-items: center; gap: 6px; }
  .body { flex: 1; min-height: 0; overflow: auto; }
</style>
