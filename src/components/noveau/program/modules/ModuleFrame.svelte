<script lang="ts">
  import type { Snippet } from 'svelte';

  const {
    title,
    pass,
    blurb,
    enabled,
    children,
  }: {
    title: string;
    pass: string;
    blurb: string;
    /** Omitted for modules without an enable state; false shows an "off" tag. */
    enabled?: boolean;
    children: Snippet;
  } = $props();
</script>

<section class="mf">
  <header class="sec-h">
    <h3>{title}</h3>
    <span class="cap" title={pass}>{pass}</span>
    {#if enabled === false}<span class="t-cap off">off</span>{/if}
  </header>
  <p class="t-cap blurb">{blurb}</p>
  <div class="body">{@render children()}</div>
</section>

<style>
  .mf { display: flex; flex-direction: column; min-width: 0; min-height: 0; height: 100%; overflow: hidden; }
  .sec-h { flex: none; }
  .blurb { margin: 0 0 8px; padding: 0 4px; line-height: 1.35; }
  .off { flex: none; }
  .body { flex: 1 1 auto; min-height: 0; overflow: hidden; }
  .mf :global(.jump) {
    width: 20px; height: 20px; padding: 0; flex: 0 0 auto;
    display: inline-flex; align-items: center; justify-content: center;
    background: transparent; border: none; border-radius: var(--radius-s); cursor: pointer;
    font-family: var(--font-sans); font-size: var(--fs-xl); line-height: 1; color: var(--text-dim);
  }
  .mf :global(.jump:hover), .mf :global(.jump:focus-visible) { color: var(--accent); }
</style>
